/**
 * Image API Routes
 * 
 * 简化的图片 API，支持：
 * - GET /i/:slug - 随机图片（302 重定向）
 * - GET /i/:slug?json=true - 返回图片列表 JSON
 * - GET /i/:slug?json=true&random=true - 返回随机图片 JSON（不重定向）
 * - GET /i/:slug/:filename - 返回指定图片
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { files, albums } from '../db/schema.js';
import type { StorageDriver } from '../drivers/interface.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { getAppSettings } from '../lib/appSettings.js';

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const imageApiRouter = new Hono();
const SEARCH_MIN_SCORE = Number.isFinite(Number.parseFloat(process.env.I_SEARCH_MIN_SCORE || ''))
    ? Number.parseFloat(process.env.I_SEARCH_MIN_SCORE || '')
    : 6;
const SEARCH_MAX_CANDIDATES = 200;

const SYNONYM_GROUPS = [
    ['幸福', '开心', '高兴', '快乐', '治愈', '满足', '甜蜜'],
    ['摸头', '摸摸头', '摸头杀', 'rua', 'rua头', '揉头'],
    ['可爱', '萌', '卖萌', '软萌', '可可爱爱'],
    ['委屈', '难过', '伤心', '沮丧'],
    ['生气', '愤怒', '炸毛', '不爽'],
    ['害羞', '脸红', '羞涩'],
];

interface RankedFile {
    file: typeof files.$inferSelect;
    score: number;
    matchedTerms: string[];
}

function normalizeText(input: string): string {
    return input
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function flattenText(input: string): string {
    return normalizeText(input).replace(/\s+/g, '');
}

function splitTerms(input: string): string[] {
    const normalized = normalizeText(input);
    if (!normalized) return [];

    const terms = normalized.split(/\s+/).filter(Boolean);
    const joined = normalized.replace(/\s+/g, '');

    if (terms.length <= 1 && joined.length >= 4) {
        // 中文连续短语在无空格输入时，额外生成 2-gram 提升召回
        for (let i = 0; i < joined.length - 1; i++) {
            terms.push(joined.slice(i, i + 2));
        }
    }

    return Array.from(new Set(terms.filter((t) => t.length > 0)));
}

function expandTerms(terms: string[]): string[] {
    const expanded = new Set<string>(terms);

    for (const term of terms) {
        for (const group of SYNONYM_GROUPS) {
            if (group.includes(term)) {
                for (const item of group) expanded.add(item);
            }
        }
    }

    return Array.from(expanded);
}

function rankFilesByQuery(
    albumFiles: Array<typeof files.$inferSelect>,
    query: string,
): RankedFile[] {
    const rawQuery = query.trim();
    if (!rawQuery) return [];

    const phrase = flattenText(rawQuery);
    const terms = expandTerms(splitTerms(rawQuery));
    const ranked: RankedFile[] = [];

    for (const file of albumFiles) {
        const filenameFlat = flattenText(file.originalName || '');
        const captionFlat = flattenText(file.caption || '');
        const semanticFlat = flattenText(file.semanticDescription || '');
        const tags = Array.isArray(file.tags) ? file.tags.filter((t) => typeof t === 'string') : [];
        const tagsFlat = tags.map((t) => flattenText(t));
        const aliases = Array.isArray(file.aliases) ? file.aliases.filter((t) => typeof t === 'string') : [];
        const aliasesFlat = aliases.map((t) => flattenText(t));

        let score = 0;
        const matchedTerms = new Set<string>();

        if (phrase.length >= 2) {
            if (aliasesFlat.some((a) => a.includes(phrase))) score += 14;
            if (tagsFlat.some((t) => t.includes(phrase))) score += 12;
            if (captionFlat.includes(phrase)) score += 10;
            if (semanticFlat.includes(phrase)) score += 8;
            if (filenameFlat.includes(phrase)) score += 6;
        }

        for (const term of terms) {
            const t = flattenText(term);
            if (!t) continue;

            let matched = false;
            if (aliasesFlat.some((a) => a.includes(t))) {
                score += 6;
                matched = true;
            }
            if (tagsFlat.some((tag) => tag.includes(t))) {
                score += 4;
                matched = true;
            }
            if (captionFlat.includes(t)) {
                score += 4;
                matched = true;
            }
            if (semanticFlat.includes(t)) {
                score += 3;
                matched = true;
            }
            if (filenameFlat.includes(t)) {
                score += 2;
                matched = true;
            }
            if (matched) matchedTerms.add(term);
        }

        if (matchedTerms.size >= 2) score += 2;
        if (matchedTerms.size >= 3) score += 2;

        if (score > 0) {
            ranked.push({
                file,
                score,
                matchedTerms: Array.from(matchedTerms),
            });
        }
    }

    ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ta = Date.parse(a.file.createdAt || '');
        const tb = Date.parse(b.file.createdAt || '');
        if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) {
            return tb - ta;
        }
        return a.file.originalName.localeCompare(b.file.originalName, 'zh-Hans-CN');
    });

    return ranked.slice(0, SEARCH_MAX_CANDIDATES);
}

// Apply rate limiting to all image API routes
imageApiRouter.use('*', rateLimit());

/**
 * GET /i
 * List all available API endpoints
 */
imageApiRouter.get('/', async (c) => {
    const publicAlbums = await db
        .select({
            name: albums.name,
            slug: albums.slug,
            path: albums.path,
        })
        .from(albums)
        .where(eq(albums.isPublic, true));

    const endpoints = publicAlbums.map((album) => ({
        name: album.name,
        endpoint: `/i/${album.slug}`,
        usage: {
            random: `GET ${config.baseUrl}/i/${album.slug}`,
            list: `GET ${config.baseUrl}/i/${album.slug}?json=true`,
            specific: `GET ${config.baseUrl}/i/${album.slug}/{filename}`,
        },
    }));

    return c.json({
        success: true,
        baseUrl: config.baseUrl,
        endpoints,
        rateLimit: {
            limit: config.rateLimit.maxRequests,
            windowMs: config.rateLimit.windowMs,
            description: `${config.rateLimit.maxRequests} requests per ${config.rateLimit.windowMs / 1000} seconds`,
        },
    });
});

/**
 * GET /i/:slug
 * Random image from album (redirect) or list (json=true)
 */
imageApiRouter.get('/:slug', async (c) => {
    const slug = c.req.param('slug');
    const storage = c.get('storage');
    const wantJson = c.req.query('json') === 'true';
    const wantRandom = c.req.query('random') === 'true';
    const query = (c.req.query('q') || '').trim();
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const appSettings = await getAppSettings();
    const allowRuleSearch = appSettings.retrieval.ruleSearchEnabled;

    // Find album
    const album = await db
        .select()
        .from(albums)
        .where(and(eq(albums.slug, slug), eq(albums.isPublic, true)))
        .get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在或未公开' }, 404);
    }

    // Get files in album
    const albumFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, album.id));

    if (albumFiles.length === 0) {
        return c.json({ success: false, error: '相册中没有图片' }, 404);
    }

    const ranked = query && allowRuleSearch ? rankFilesByQuery(albumFiles, query) : [];
    const best = ranked[0];
    const hasReliableBest = !!best && best.score >= SEARCH_MIN_SCORE;
    const queryMatchedFiles = ranked.map((r) => r.file);

    // Return JSON list
    if (wantJson && !wantRandom) {
        const offset = (page - 1) * limit;
        const sourceFiles = query ? queryMatchedFiles : albumFiles;
        const paginatedFiles = sourceFiles.slice(offset, offset + limit);
        const scoreMap = new Map(ranked.map((r) => [r.file.id, { score: r.score, matchedTerms: r.matchedTerms }]));

        return c.json({
            success: true,
            data: {
                album: {
                    name: album.name,
                    slug: album.slug,
                    totalImages: sourceFiles.length,
                },
                query: query || undefined,
                ruleSearchEnabled: allowRuleSearch,
                images: paginatedFiles.map((file) => ({
                    id: file.id,
                    name: file.originalName,
                    url: storage.getUrl(file.key),
                    directUrl: `${config.baseUrl}/i/${slug}/${file.originalName}`,
                    width: file.width,
                    height: file.height,
                    score: scoreMap.get(file.id)?.score,
                    matchedTerms: scoreMap.get(file.id)?.matchedTerms || [],
                })),
            },
            pagination: {
                page,
                limit,
                total: sourceFiles.length,
                totalPages: Math.ceil(sourceFiles.length / limit),
            },
        });
    }

    // Pick target file:
    // - 有 q 且命中阈值时优先返回最高分
    // - 否则回退随机
    const randomIndex = Math.floor(Math.random() * albumFiles.length);
    const randomFile = albumFiles[randomIndex];
    const targetFile = hasReliableBest && best ? best.file : randomFile;
    const url = storage.getUrl(targetFile.key);

    // Return random as JSON (no redirect)
    if (wantJson && wantRandom) {
        return c.json({
            success: true,
            data: {
                id: targetFile.id,
                name: targetFile.originalName,
                url,
                directUrl: `${config.baseUrl}/i/${slug}/${targetFile.originalName}`,
                width: targetFile.width,
                height: targetFile.height,
                query: query || undefined,
                score: hasReliableBest && best ? best.score : undefined,
                matchedTerms: hasReliableBest && best ? best.matchedTerms : [],
                fallbackRandom: query ? !hasReliableBest : false,
                ruleSearchEnabled: allowRuleSearch,
            },
        });
    }

    // Default: redirect to best match or random fallback
    return c.redirect(url);
});

/**
 * GET /i/:slug/:filename
 * Get specific image by filename
 */
imageApiRouter.get('/:slug/:filename', async (c) => {
    const slug = c.req.param('slug');
    const filename = c.req.param('filename');
    const storage = c.get('storage');
    const wantJson = c.req.query('json') === 'true';
    const appSettings = await getAppSettings();
    const allowRuleSearch = appSettings.retrieval.ruleSearchEnabled;

    // Find album
    const album = await db
        .select()
        .from(albums)
        .where(and(eq(albums.slug, slug), eq(albums.isPublic, true)))
        .get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在或未公开' }, 404);
    }

    // Find file by original name
    const file = await db
        .select()
        .from(files)
        .where(and(
            eq(files.albumId, album.id),
            eq(files.originalName, filename)
        ))
        .get();

    if (!file) {
        // Try by ID as fallback
        const fileById = await db
            .select()
            .from(files)
            .where(and(
                eq(files.albumId, album.id),
                eq(files.id, filename)
            ))
            .get();

        if (!fileById) {
            // 语义回退：文件名未命中时，将 filename 当作查询词
            const fallbackQuery = filename.replace(/\.[^.]+$/, '').trim();
            const albumFiles = await db
                .select()
                .from(files)
                .where(eq(files.albumId, album.id));
            const ranked = fallbackQuery && allowRuleSearch ? rankFilesByQuery(albumFiles, fallbackQuery) : [];
            const best = ranked[0];

            if (best && best.score >= SEARCH_MIN_SCORE) {
                const matchedUrl = storage.getUrl(best.file.key);
                if (wantJson) {
                    return c.json({
                        success: true,
                        data: {
                            id: best.file.id,
                            name: best.file.originalName,
                            url: matchedUrl,
                            width: best.file.width,
                            height: best.file.height,
                            semanticFallback: true,
                            query: fallbackQuery,
                            score: best.score,
                            matchedTerms: best.matchedTerms,
                        },
                    });
                }
                return c.redirect(matchedUrl);
            }

            return c.json({ success: false, error: '图片不存在' }, 404);
        }

        const url = storage.getUrl(fileById.key);
        if (wantJson) {
            return c.json({
                success: true,
                data: {
                    id: fileById.id,
                    name: fileById.originalName,
                    url,
                    width: fileById.width,
                    height: fileById.height,
                },
            });
        }
        return c.redirect(url);
    }

    const url = storage.getUrl(file.key);

    if (wantJson) {
        return c.json({
            success: true,
            data: {
                id: file.id,
                name: file.originalName,
                url,
                width: file.width,
                height: file.height,
            },
        });
    }

    return c.redirect(url);
});

export { imageApiRouter };
