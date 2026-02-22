import { Hono } from 'hono';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { files, albums, tags } from '../db/schema.js';
import type { StorageDriver } from '../drivers/interface.js';

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const publicRouter = new Hono();

/**
 * GET /api/public/albums
 * List all public albums (no auth required)
 */
publicRouter.get('/albums', async (c) => {
    const results = await db
        .select({
            id: albums.id,
            name: albums.name,
            slug: albums.slug,
            path: albums.path,
            coverFileId: albums.coverFileId,
        })
        .from(albums)
        .where(eq(albums.isPublic, true));

    return c.json({
        success: true,
        data: results,
    });
});

/**
 * GET /api/public/albums/:slug
 * Get a public album by slug (no auth required)
 */
publicRouter.get('/albums/:slug', async (c) => {
    const slug = c.req.param('slug');
    const storage = c.get('storage');

    const album = await db
        .select()
        .from(albums)
        .where(and(eq(albums.slug, slug), eq(albums.isPublic, true)))
        .get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在或不公开' }, 404);
    }

    // Get files in this album
    const albumFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, album.id));

    return c.json({
        success: true,
        data: {
            album: {
                id: album.id,
                name: album.name,
                slug: album.slug,
                path: album.path,
            },
            files: albumFiles.map((file) => ({
                id: file.id,
                originalName: file.originalName,
                width: file.width,
                height: file.height,
                thumbhash: file.thumbhash,
                tags: file.tags,
                url: storage.getUrl(file.key),
            })),
        },
    });
});

/**
 * GET /api/public/albums/:slug/files
 * Get files in a public album (no auth required)
 */
publicRouter.get('/albums/:slug/files', async (c) => {
    const slug = c.req.param('slug');
    const storage = c.get('storage');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const tag = c.req.query('tag'); // Optional tag filter
    const offset = (page - 1) * limit;

    const album = await db
        .select()
        .from(albums)
        .where(and(eq(albums.slug, slug), eq(albums.isPublic, true)))
        .get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在或不公开' }, 404);
    }

    const allFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, album.id));

    // Filter by tag if specified (done in JS since SQLite JSON query is limited)
    let filteredResults = allFiles;
    if (tag) {
        filteredResults = allFiles.filter((file) => {
            const fileTags = file.tags as string[] || [];
            return fileTags.includes(tag);
        });
    }

    const paginatedResults = filteredResults.slice(offset, offset + limit);

    return c.json({
        success: true,
        data: paginatedResults.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            width: file.width,
            height: file.height,
            thumbhash: file.thumbhash,
            tags: file.tags,
            url: storage.getUrl(file.key),
        })),
        pagination: {
            page,
            limit,
            total: filteredResults.length,
            totalPages: Math.ceil(filteredResults.length / limit),
        },
    });
});

/**
 * GET /api/public/albums/:slug/random
 * Get a random image from a public album (no auth required)
 */
publicRouter.get('/albums/:slug/random', async (c) => {
    const slug = c.req.param('slug');
    const storage = c.get('storage');
    const redirect = c.req.query('redirect') !== 'false'; // Default: redirect to image

    const album = await db
        .select()
        .from(albums)
        .where(and(eq(albums.slug, slug), eq(albums.isPublic, true)))
        .get();

    if (!album) {
        return c.json({ success: false, error: '相册不存在或不公开' }, 404);
    }

    // Get all files in album
    const albumFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, album.id));

    if (albumFiles.length === 0) {
        return c.json({ success: false, error: '相册中没有图片' }, 404);
    }

    // Pick random
    const randomIndex = Math.floor(Math.random() * albumFiles.length);
    const randomFile = albumFiles[randomIndex];

    const url = storage.getUrl(randomFile.key);

    if (redirect) {
        return c.redirect(url);
    }

    return c.json({
        success: true,
        data: {
            id: randomFile.id,
            originalName: randomFile.originalName,
            width: randomFile.width,
            height: randomFile.height,
            tags: randomFile.tags,
            url,
        },
    });
});

/**
 * GET /api/public/tags
 * List all tags (no auth required)
 */
publicRouter.get('/tags', async (c) => {
    const publicAlbumRows = await db
        .select({ id: albums.id })
        .from(albums)
        .where(eq(albums.isPublic, true));

    if (publicAlbumRows.length === 0) {
        return c.json({
            success: true,
            data: [],
        });
    }

    const publicAlbumIds = publicAlbumRows.map((row) => row.id);
    const publicFiles = await db
        .select({ tags: files.tags })
        .from(files)
        .where(inArray(files.albumId, publicAlbumIds));

    const existingTags = await db.select().from(tags);
    const existingByName = new Map(
        existingTags.map((item) => [item.name.trim().toLowerCase(), item]),
    );

    const tagCounter = new Map<string, { name: string; fileCount: number }>();
    for (const row of publicFiles) {
        const fileTags = Array.isArray(row.tags) ? row.tags : [];
        for (const rawTag of fileTags) {
            const name = String(rawTag || '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            const current = tagCounter.get(key);
            if (current) {
                current.fileCount += 1;
            } else {
                tagCounter.set(key, { name, fileCount: 1 });
            }
        }
    }

    const results = Array.from(tagCounter.entries()).map(([key, value]) => {
        const existing = existingByName.get(key);
        return {
            id: existing?.id || `public-${key}`,
            name: existing?.name || value.name,
            slug: existing?.slug || key.replace(/\s+/g, '-'),
            color: existing?.color || '#6366f1',
            fileCount: value.fileCount,
        };
    }).sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name, 'zh-Hans-CN'));

    return c.json({
        success: true,
        data: results,
    });
});

/**
 * GET /api/public/tags/:slug/files
 * Get files with a specific tag (no auth required, only from public albums)
 */
publicRouter.get('/tags/:slug/files', async (c) => {
    const tagSlug = c.req.param('slug');
    const storage = c.get('storage');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');

    // Get all files from public albums
    const publicAlbumIds = await db
        .select({ id: albums.id })
        .from(albums)
        .where(eq(albums.isPublic, true));

    if (publicAlbumIds.length === 0) {
        return c.json({ success: true, data: [], pagination: { page, limit } });
    }

    const ids = publicAlbumIds.map((a) => a.id);

    // Get all files from public albums
    const allFiles = await db.select().from(files);

    // Filter by tag and public album
    const filteredFiles = allFiles.filter((file) => {
        if (!ids.includes(file.albumId || '')) return false;
        const fileTags = file.tags as string[] || [];
        return fileTags.some((t) => t.toLowerCase() === tagSlug.toLowerCase());
    });

    // Paginate
    const paginatedFiles = filteredFiles.slice((page - 1) * limit, page * limit);

    return c.json({
        success: true,
        data: paginatedFiles.map((file) => ({
            id: file.id,
            originalName: file.originalName,
            width: file.width,
            height: file.height,
            thumbhash: file.thumbhash,
            tags: file.tags,
            url: storage.getUrl(file.key),
        })),
        pagination: { page, limit, total: filteredFiles.length },
    });
});

/**
 * GET /api/public/random
 * Get a random image from any public album
 */
publicRouter.get('/random', async (c) => {
    const storage = c.get('storage');
    const tag = c.req.query('tag'); // Optional tag filter
    const redirect = c.req.query('redirect') !== 'false';

    // Get all public albums
    const publicAlbumIds = await db
        .select({ id: albums.id })
        .from(albums)
        .where(eq(albums.isPublic, true));

    if (publicAlbumIds.length === 0) {
        return c.json({ success: false, error: '没有公开的相册' }, 404);
    }

    const ids = publicAlbumIds.map((a) => a.id);

    // Get all files from public albums
    const allFiles = await db.select().from(files);

    // Filter by public album and optionally by tag
    let filteredFiles = allFiles.filter((file) => ids.includes(file.albumId || ''));

    if (tag) {
        filteredFiles = filteredFiles.filter((file) => {
            const fileTags = file.tags as string[] || [];
            return fileTags.some((t) => t.toLowerCase() === tag.toLowerCase());
        });
    }

    if (filteredFiles.length === 0) {
        return c.json({ success: false, error: '没有符合条件的图片' }, 404);
    }

    // Pick random
    const randomIndex = Math.floor(Math.random() * filteredFiles.length);
    const randomFile = filteredFiles[randomIndex];

    const url = storage.getUrl(randomFile.key);

    if (redirect) {
        return c.redirect(url);
    }

    return c.json({
        success: true,
        data: {
            id: randomFile.id,
            originalName: randomFile.originalName,
            width: randomFile.width,
            height: randomFile.height,
            tags: randomFile.tags,
            url,
        },
    });
});

export { publicRouter };
