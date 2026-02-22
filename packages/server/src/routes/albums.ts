import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, isNull, and, sql, inArray, like } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { albums, files } from '../db/schema.js';
import { getAppSettings } from '../lib/appSettings.js';
import type { StorageDriver } from '../drivers/interface.js';

const albumsRouter = new Hono();

type DedupeKeepStrategy = 'oldest' | 'newest' | 'first';

function normalizeKeepStrategy(value: string | undefined): DedupeKeepStrategy {
    if (value === 'newest' || value === 'first') return value;
    return 'oldest';
}

function parseUnixTime(input: string): number {
    const ms = Date.parse(input);
    if (Number.isFinite(ms)) return ms;
    return 0;
}

function pickKeepFile(
    fileList: Array<{ id: string; originalName: string; createdAt: string }>,
    keep: DedupeKeepStrategy,
) {
    const sorted = fileList.slice().sort((a, b) => {
        const ta = parseUnixTime(a.createdAt);
        const tb = parseUnixTime(b.createdAt);

        if (keep === 'newest' && tb !== ta) return tb - ta;
        if (keep === 'oldest' && ta !== tb) return ta - tb;

        if (a.originalName !== b.originalName) {
            return a.originalName.localeCompare(b.originalName, 'zh-Hans-CN');
        }
        return a.id.localeCompare(b.id, 'en-US');
    });
    return sorted[0];
}

async function calculateSha256(buffer: Buffer): Promise<string> {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

interface AnnotationParsed {
    caption: string;
    semanticDescription: string;
    aliases: string[];
    tags: string[];
}

function parseHintKeywords(input: string | undefined): string[] {
    if (!input) return [];
    const raw = String(input).trim();
    if (!raw) return [];

    const tokens = raw
        .split(/[,\n，、;；\t ]+/g)
        .map((x) => x.trim())
        .filter(Boolean);

    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of tokens) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(item.slice(0, 40));
        if (result.length >= 30) break;
    }
    return result;
}

function parseBooleanQuery(input: string | undefined): boolean | undefined {
    if (typeof input !== 'string') return undefined;
    const normalized = input.trim().toLowerCase();
    if (!normalized) return undefined;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

function hasExistingAnnotation(file: {
    caption?: string | null;
    semanticDescription?: string | null;
    aliases?: unknown;
    tags?: unknown;
}): boolean {
    const hasCaption = !!String(file.caption || '').trim();
    const hasSemantic = !!String(file.semanticDescription || '').trim();
    const hasAliases = Array.isArray(file.aliases) && file.aliases.length > 0;
    const hasTags = Array.isArray(file.tags) && file.tags.length > 0;
    return hasCaption || hasSemantic || hasAliases || hasTags;
}

function uniqueStrings(items: Array<unknown>): string[] {
    const set = new Set<string>();
    for (const item of items) {
        const text = String(item ?? '').trim();
        if (text) set.add(text);
    }
    return Array.from(set);
}

function parseJsonObject(raw: string): Record<string, any> {
    const text = raw.trim();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1]);
            } catch {
                // continue
            }
        }
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first >= 0 && last > first) {
            const candidate = text.slice(first, last + 1);
            try {
                return JSON.parse(candidate);
            } catch {
                // ignore
            }
        }
    }
    return {};
}

function normalizeAnnotationOutput(payload: Record<string, any>): AnnotationParsed {
    const caption = String(payload.caption || payload.title || '').trim();
    const semanticDescription = String(
        payload.semantic_description ||
        payload.semanticDescription ||
        payload.description ||
        '',
    ).trim();

    const aliases = uniqueStrings([
        ...(Array.isArray(payload.aliases) ? payload.aliases : []),
        ...(Array.isArray(payload.retrieval_phrases) ? payload.retrieval_phrases : []),
    ]);

    const tags = uniqueStrings([
        ...(Array.isArray(payload.tags) ? payload.tags : []),
        ...(Array.isArray(payload.mood_tags) ? payload.mood_tags : []),
        ...(Array.isArray(payload.action_tags) ? payload.action_tags : []),
        ...(Array.isArray(payload.character_tags) ? payload.character_tags : []),
        ...(Array.isArray(payload.scene_tags) ? payload.scene_tags : []),
        ...(Array.isArray(payload.style_tags) ? payload.style_tags : []),
        ...(Array.isArray(payload.object_tags) ? payload.object_tags : []),
    ]);

    return { caption, semanticDescription, aliases, tags };
}

function buildAnnotationApiUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(normalized)) return normalized;
    if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
    return `${normalized}/v1/chat/completions`;
}

function interpolatePrompt(template: string, context: Record<string, string>): string {
    let output = template;
    for (const [key, value] of Object.entries(context)) {
        output = output.replaceAll(`{{${key}}}`, value);
    }
    return output;
}

async function callAnnotationLLM(args: {
    apiUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    imageDataUrl: string;
}) {
    const response = await fetch(args.apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify({
            model: args.model,
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: '你是图片标注助手，只返回 JSON。' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: args.prompt },
                        { type: 'image_url', image_url: { url: args.imageDataUrl } },
                    ],
                },
            ],
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`标注接口失败(${response.status}): ${text || response.statusText}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('标注接口返回为空');
    }
    return parseJsonObject(content);
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, event: string, payload: unknown) {
    const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(encoder.encode(text));
}

function sendSseComment(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, comment: string) {
    controller.enqueue(encoder.encode(`: ${comment}\n\n`));
}

/**
 * Helper: Generate URL-friendly slug from name
 */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Helper: Build full path for an album
 */
async function buildPath(albumId: string | null): Promise<string> {
    if (!albumId) return '/';

    const parts: string[] = [];
    let currentId: string | null = albumId;

    while (currentId) {
        const album = await db.select().from(albums).where(eq(albums.id, currentId)).get();
        if (!album) break;
        parts.unshift(album.slug);
        currentId = album.parentId;
    }

    return '/' + parts.join('/');
}

/**
 * GET /api/albums
 * List all albums (optionally filtered by parent)
 */
albumsRouter.get('/', async (c) => {
    const parentId = c.req.query('parentId');
    const flat = c.req.query('flat') === 'true';

    let results;

    if (flat) {
        // Return all albums in a flat list
        results = await db.select().from(albums).orderBy(albums.path);
    } else if (parentId) {
        results = await db.select().from(albums).where(eq(albums.parentId, parentId)).orderBy(albums.name);
    } else {
        // Return root-level albums
        results = await db.select().from(albums).where(isNull(albums.parentId)).orderBy(albums.name);
    }

    // Enrich results with file count
    const enrichedResults = await Promise.all(results.map(async (album) => {
        const countResult = await db
            .select({ count: sql<number>`count(*)` })
            .from(files)
            .where(eq(files.albumId, album.id))
            .get();

        return {
            ...album,
            fileCount: countResult ? countResult.count : 0
        };
    }));

    return c.json({
        success: true,
        data: enrichedResults,
    });
});

/**
 * GET /api/albums/:id
 * Get single album with file count
 */
albumsRouter.get('/:id', async (c) => {
    const id = c.req.param('id');

    const album = await db.select().from(albums).where(eq(albums.id, id)).get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    // Get file count
    const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(eq(files.albumId, id))
        .get();

    // Get child albums
    const children = await db.select().from(albums).where(eq(albums.parentId, id));

    return c.json({
        success: true,
        data: {
            ...album,
            fileCount: result ? result.count : 0,
            children,
        },
    });
});

/**
 * POST /api/albums
 * Create a new album
 */
albumsRouter.post('/', async (c) => {
    const body = await c.req.json<{ name: string; parentId?: string; password?: string; isPublic?: boolean }>();

    if (!body.name || body.name.trim() === '') {
        return c.json({ success: false, error: '相册名称不能为空' }, 400);
    }

    const id = uuidv4();
    const slug = slugify(body.name);
    const parentPath = await buildPath(body.parentId || null);
    const path = parentPath === '/' ? `/${slug}` : `${parentPath}/${slug}`;

    const existing = await db.select().from(albums).where(eq(albums.slug, slug)).get();
    if (existing) {
        return c.json({ success: false, error: '相册已存在' }, 400);
    }

    const newAlbum = {
        id,
        name: body.name.trim(),
        slug,
        parentId: body.parentId || null,
        password: body.password || null,
        isPublic: body.isPublic || false,
        path,
    };

    await db.insert(albums).values(newAlbum);

    return c.json({
        success: true,
        data: newAlbum,
    });
});

/**
 * PATCH /api/albums/:id
 * Update album (rename, move, set password)
 */
albumsRouter.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; parentId?: string | null; password?: string | null; isPublic?: boolean }>();

    const album = await db.select().from(albums).where(eq(albums.id, id)).get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    const updates: Partial<typeof album> = {
        updatedAt: new Date().toISOString(),
    };

    if (body.name) {
        updates.name = body.name.trim();
        updates.slug = slugify(body.name);
    }

    if ('parentId' in body) {
        updates.parentId = body.parentId;
        // Rebuild path
        const parentPath = await buildPath(body.parentId);
        updates.path = parentPath === '/' ? `/${updates.slug || album.slug}` : `${parentPath}/${updates.slug || album.slug}`;
    }

    if ('password' in body) {
        updates.password = body.password;
    }

    if ('isPublic' in body) {
        updates.isPublic = body.isPublic;
    }

    await db.update(albums).set(updates).where(eq(albums.id, id));

    return c.json({ success: true, message: '更新成功' });
});

/**
 * DELETE /api/albums/:id
 * Delete album and all its images (recursively)
 */
albumsRouter.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const storage = c.get('storage');

    const album = await db.select().from(albums).where(eq(albums.id, id)).get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    // Find all descendant albums
    const descendantAlbums = await db.select().from(albums).where(like(albums.path, `${album.path}/%`));
    const allAlbumIds = [album.id, ...descendantAlbums.map(a => a.id)];

    // Find all files in these albums
    const albumFiles = await db.select().from(files).where(inArray(files.albumId, allAlbumIds));

    // 1. Delete files from storage
    for (const file of albumFiles) {
        try {
            await storage.delete(file.key);
        } catch (err) {
            console.error(`Failed to delete file from storage: ${file.key}`, err);
        }
    }

    // 2. Delete file records from database
    if (albumFiles.length > 0) {
        await db.delete(files).where(inArray(files.id, albumFiles.map(f => f.id)));
    }

    // 3. Delete album (sub-albums will be cascade deleted by DB)
    await db.delete(albums).where(eq(albums.id, id));

    return c.json({ success: true, message: `成功删除相册及 ${albumFiles.length} 张图片` });
});

/**
 * POST /api/albums/dedupe
 * De-duplicate files in a single album by SHA-256
 */
albumsRouter.post('/dedupe', async (c) => {
    const storage = c.get('storage');
    const body = await c.req.json<{
        albumId?: string;
        path?: string;
        keep?: DedupeKeepStrategy;
        dryRun?: boolean;
    }>();

    const albumId = (body.albumId || body.path || '').trim();
    if (!albumId) {
        return c.json({ success: false, error: '缺少 albumId' }, 400);
    }

    const keep = normalizeKeepStrategy(body.keep);
    const dryRun = body.dryRun === true;

    const album = await db.select().from(albums).where(eq(albums.id, albumId)).get();
    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    const albumFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, albumId))
        .orderBy(desc(files.createdAt));

    if (albumFiles.length <= 1) {
        return c.json({
            success: true,
            data: {
                albumId,
                keep,
                dryRun,
                scannedFiles: albumFiles.length,
                uniqueHashes: albumFiles.length,
                duplicateGroups: 0,
                duplicateFiles: 0,
                removedFiles: 0,
                failedFiles: 0,
                groups: [],
            },
        });
    }

    const hashMap = new Map<string, typeof albumFiles>();
    for (const file of albumFiles) {
        try {
            const buffer = await storage.getBuffer(file.key);
            const digest = await calculateSha256(buffer);
            const list = hashMap.get(digest) || [];
            list.push(file);
            hashMap.set(digest, list);
        } catch (err) {
            console.error(`[Dedupe] Read file failed: ${file.key}`, err);
        }
    }

    const groups: Array<{
        sha256: string;
        keep: { id: string; filename: string; key: string; size: number; createdAt: string; sha256: string };
        remove: Array<{ id: string; filename: string; key: string; size: number; createdAt: string; sha256: string }>;
    }> = [];

    for (const [sha256, grouped] of hashMap.entries()) {
        if (grouped.length <= 1) continue;
        const keepFile = pickKeepFile(grouped, keep);
        if (!keepFile) continue;

        const removeFiles = grouped.filter((f) => f.id !== keepFile.id);
        if (removeFiles.length === 0) continue;

        groups.push({
            sha256,
            keep: {
                id: keepFile.id,
                filename: keepFile.originalName,
                key: keepFile.key,
                size: keepFile.size,
                createdAt: keepFile.createdAt,
                sha256,
            },
            remove: removeFiles.map((f) => ({
                id: f.id,
                filename: f.originalName,
                key: f.key,
                size: f.size,
                createdAt: f.createdAt,
                sha256,
            })),
        });
    }

    const duplicateFiles = groups.reduce((sum, group) => sum + group.remove.length, 0);
    let removedFiles = 0;
    let failedFiles = 0;

    if (!dryRun && duplicateFiles > 0) {
        for (const group of groups) {
            const keepFile = await db.select().from(files).where(eq(files.id, group.keep.id)).get();
            if (!keepFile) continue;

            const keepTags = Array.isArray(keepFile.tags) ? [...keepFile.tags] : [];
            const mergedTags = new Set<string>(keepTags);

            for (const removeFile of group.remove) {
                const removeRecord = await db.select().from(files).where(eq(files.id, removeFile.id)).get();
                if (!removeRecord) {
                    failedFiles++;
                    continue;
                }

                const tags = Array.isArray(removeRecord.tags) ? removeRecord.tags : [];
                for (const tag of tags) mergedTags.add(tag);

                try {
                    await storage.delete(removeRecord.key);
                    await db.delete(files).where(eq(files.id, removeRecord.id));
                    removedFiles++;
                } catch (err) {
                    console.error(`[Dedupe] Delete failed: ${removeRecord.key}`, err);
                    failedFiles++;
                }
            }

            const mergedArray = Array.from(mergedTags);
            if (
                mergedArray.length !== keepTags.length ||
                mergedArray.some((tag, idx) => tag !== keepTags[idx])
            ) {
                await db
                    .update(files)
                    .set({ tags: mergedArray, updatedAt: new Date().toISOString() })
                    .where(eq(files.id, keepFile.id));
            }
        }
    }

    return c.json({
        success: true,
        data: {
            albumId,
            keep,
            dryRun,
            scannedFiles: albumFiles.length,
            uniqueHashes: hashMap.size,
            duplicateGroups: groups.length,
            duplicateFiles,
            removedFiles,
            failedFiles,
            groups,
        },
    });
});

/**
 * GET /api/albums/:id/annotate/stream
 * Annotate all files in an album with streaming progress (SSE)
 */
albumsRouter.get('/:id/annotate/stream', async (c) => {
    const albumId = c.req.param('id');
    const singleFileId = (c.req.query('fileId') || '').trim();
    const skipExistingFromQuery = parseBooleanQuery(c.req.query('skipExisting'));
    const overwriteFromQuery = parseBooleanQuery(c.req.query('overwrite'));
    // Priority: explicit skipExisting > explicit overwrite (inverse) > default
    // Default: batch mode skips existing; single-file mode overwrites existing.
    const skipExisting = skipExistingFromQuery
        ?? (overwriteFromQuery !== undefined ? !overwriteFromQuery : !singleFileId);
    const overwrite = !skipExisting;
    const requestConcurrency = Number.parseInt(c.req.query('concurrency') || '', 10);
    const hintKeywords = parseHintKeywords(c.req.query('hints'));

    const album = await db.select().from(albums).where(eq(albums.id, albumId)).get();
    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    const appSettings = await getAppSettings();
    const annotationConfig = appSettings.annotation;
    const concurrency = Number.isFinite(requestConcurrency)
        ? Math.min(10, Math.max(1, requestConcurrency))
        : annotationConfig.concurrency;

    if (!annotationConfig.baseUrl.trim() || !annotationConfig.apiKey.trim() || !annotationConfig.prompt.trim()) {
        return c.json({ success: false, error: '请先在设置中配置标注 Base URL、API Key 和 Prompt' }, 400);
    }

    const allFiles = await db.select().from(files).where(eq(files.albumId, albumId)).orderBy(desc(files.createdAt));
    let filteredFiles = allFiles;
    if (singleFileId) {
        filteredFiles = allFiles.filter((file) => file.id === singleFileId);
        if (filteredFiles.length === 0) {
            return c.json({ success: false, error: '目标图片不在该相册中' }, 404);
        }
    }

    const skippedByExisting = overwrite ? [] : filteredFiles.filter((file) => hasExistingAnnotation(file));
    const targets = overwrite
        ? filteredFiles
        : filteredFiles.filter((file) => !hasExistingAnnotation(file));

    const storage = c.get('storage');
    const apiUrl = buildAnnotationApiUrl(annotationConfig.baseUrl);
    const model = annotationConfig.model?.trim() || process.env.ANNOTATION_MODEL || 'gpt-4o-mini';

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();
            // Send a padding comment first to mitigate proxy/browser buffering.
            sendSseComment(controller, encoder, 'sse-stream-start ' + ' '.repeat(2048));
            let processed = 0;
            let success = 0;
            let failed = 0;
            let cursor = 0;

            sendSse(controller, encoder, 'start', {
                albumId,
                albumName: album.name,
                scanned: filteredFiles.length,
                total: targets.length,
                skipped: skippedByExisting.length,
                skipExisting,
                overwrite,
                concurrency,
                hintKeywords,
                fileId: singleFileId || undefined,
                timestamp: Date.now(),
            });

            if (targets.length === 0) {
                sendSse(controller, encoder, 'done', {
                    total: 0,
                    processed: 0,
                    success: 0,
                    failed: 0,
                    skipped: skippedByExisting.length,
                    timestamp: Date.now(),
                });
                controller.close();
                return;
            }

            const heartbeat = setInterval(() => {
                sendSseComment(controller, encoder, `heartbeat ${Date.now()}`);
                sendSse(controller, encoder, 'heartbeat', {
                    processed,
                    success,
                    failed,
                    total: targets.length,
                    timestamp: Date.now(),
                });
            }, 1000);

            const runOne = async () => {
                while (true) {
                    const index = cursor++;
                    if (index >= targets.length) return;
                    const file = targets[index];
                    const startedAt = Date.now();
                    try {
                        sendSse(controller, encoder, 'progress', {
                            status: 'running',
                            fileId: file.id,
                            filename: file.originalName,
                            processed,
                            total: targets.length,
                            timestamp: Date.now(),
                        });

                        const buffer = await storage.getBuffer(file.key);
                        const dataUrl = `data:${file.mimeType};base64,${buffer.toString('base64')}`;
                        let prompt = interpolatePrompt(annotationConfig.prompt, {
                            original_name: file.originalName,
                            album_name: album.name,
                            album_id: album.id,
                            file_id: file.id,
                        });
                        if (hintKeywords.length > 0) {
                            prompt += `\n\n[User retrieval hints]\n${hintKeywords.join(', ')}\n`;
                            prompt += 'Prefer to reflect these hints in aliases/tags when image content supports them. ';
                            prompt += 'Do not force irrelevant hints.';
                        }

                        const llmJson = await callAnnotationLLM({
                            apiUrl,
                            apiKey: annotationConfig.apiKey,
                            model,
                            prompt,
                            imageDataUrl: dataUrl,
                        });
                        const parsed = normalizeAnnotationOutput(llmJson);
                        const currentTags = Array.isArray(file.tags) ? file.tags : [];
                        const mergedTags = uniqueStrings([...currentTags, ...parsed.tags]);
                        const mergedAliases = uniqueStrings([
                            ...(Array.isArray(file.aliases) ? file.aliases : []),
                            ...parsed.aliases,
                        ]);

                        await db
                            .update(files)
                            .set({
                                caption: parsed.caption || file.caption || null,
                                semanticDescription: parsed.semanticDescription || file.semanticDescription || null,
                                aliases: mergedAliases,
                                tags: mergedTags,
                                annotationUpdatedAt: new Date().toISOString(),
                                updatedAt: new Date().toISOString(),
                            })
                            .where(eq(files.id, file.id));

                        success++;
                        processed++;
                        sendSse(controller, encoder, 'item', {
                            status: 'success',
                            fileId: file.id,
                            filename: file.originalName,
                            caption: parsed.caption,
                            tagsAdded: parsed.tags.length,
                            aliasesAdded: parsed.aliases.length,
                            durationMs: Date.now() - startedAt,
                            processed,
                            total: targets.length,
                            timestamp: Date.now(),
                        });
                    } catch (err: any) {
                        failed++;
                        processed++;
                        sendSse(controller, encoder, 'item', {
                            status: 'failed',
                            fileId: file.id,
                            filename: file.originalName,
                            error: err?.message || '标注失败',
                            durationMs: Date.now() - startedAt,
                            processed,
                            total: targets.length,
                            timestamp: Date.now(),
                        });
                    }
                }
            };

            try {
                await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, () => runOne()));
                sendSse(controller, encoder, 'done', {
                    total: targets.length,
                    processed,
                    success,
                    failed,
                    skipped: skippedByExisting.length,
                    timestamp: Date.now(),
                });
            } finally {
                clearInterval(heartbeat);
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
});

/**
 * POST /api/albums/:id/verify
 * Verify album password
 */
albumsRouter.post('/:id/verify', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ password: string }>();

    const album = await db.select().from(albums).where(eq(albums.id, id)).get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    if (!album.password) {
        return c.json({ success: true });
    }

    if (body.password === album.password) {
        return c.json({ success: true });
    }

    return c.json({ success: false, error: '密码错误' }, 401);
});

export { albumsRouter };
