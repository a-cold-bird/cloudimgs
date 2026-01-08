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

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const imageApiRouter = new Hono();

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
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');

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

    // Return JSON list
    if (wantJson && !wantRandom) {
        const offset = (page - 1) * limit;
        const paginatedFiles = albumFiles.slice(offset, offset + limit);

        return c.json({
            success: true,
            data: {
                album: {
                    name: album.name,
                    slug: album.slug,
                    totalImages: albumFiles.length,
                },
                images: paginatedFiles.map((file) => ({
                    id: file.id,
                    name: file.originalName,
                    url: storage.getUrl(file.key),
                    directUrl: `${config.baseUrl}/i/${slug}/${file.originalName}`,
                    width: file.width,
                    height: file.height,
                })),
            },
            pagination: {
                page,
                limit,
                total: albumFiles.length,
                totalPages: Math.ceil(albumFiles.length / limit),
            },
        });
    }

    // Pick random file
    const randomIndex = Math.floor(Math.random() * albumFiles.length);
    const randomFile = albumFiles[randomIndex];
    const url = storage.getUrl(randomFile.key);

    // Return random as JSON (no redirect)
    if (wantJson && wantRandom) {
        return c.json({
            success: true,
            data: {
                id: randomFile.id,
                name: randomFile.originalName,
                url,
                directUrl: `${config.baseUrl}/i/${slug}/${randomFile.originalName}`,
                width: randomFile.width,
                height: randomFile.height,
            },
        });
    }

    // Default: redirect to random image
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
