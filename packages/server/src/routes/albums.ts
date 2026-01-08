import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, isNull, and, sql, inArray, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { albums, files } from '../db/schema.js';

const albumsRouter = new Hono();

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
