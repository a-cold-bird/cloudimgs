import { Hono } from 'hono';
import type { StorageDriver } from '../drivers/interface.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateShareToken } from '../lib/shareStore.js';

// Will be injected via middleware
declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const serveRouter = new Hono();

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) return value[0];
    return value;
}

async function authorizeMediaAccess(c: any, key: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    if (!config.auth.enabled) return { ok: true };

    const accessPassword = c.req.header('x-access-password') || getFirstQueryValue(c.req.query('password'));
    if (accessPassword && accessPassword === config.auth.password) {
        return { ok: true };
    }

    const shareToken = getFirstQueryValue(c.req.query('shareToken')) || getFirstQueryValue(c.req.query('token'));
    if (!shareToken) {
        return { ok: false, status: 401, error: '需要提供访问密码' };
    }

    const file = await db.select({ albumId: files.albumId }).from(files).where(eq(files.key, key)).get();
    if (!file || !file.albumId) {
        return { ok: false, status: 403, error: '分享令牌与资源不匹配' };
    }

    const validation = await validateShareToken(shareToken, {
        albumId: file.albumId,
        allowBurnedMedia: true,
    });
    if (!validation.ok) {
        return {
            ok: false,
            status: validation.status || 403,
            error: validation.error || '分享校验失败',
        };
    }

    return { ok: true };
}

/**
 * GET /api/serve/:key
 * Serve a file with optional image processing
 * 
 * Query params:
 * - w: width
 * - h: height
 * - q: quality (1-100)
 * - fmt: format (jpg, png, webp, avif)
 */
serveRouter.get('/:key{.+}', async (c) => {
    const key = c.req.param('key');
    const storage = c.get('storage');

    const authz = await authorizeMediaAccess(c, key);
    if (!authz.ok) {
        return c.json({ error: authz.error }, authz.status);
    }

    // Check if file exists
    if (!(await storage.exists(key))) {
        return c.json({ error: 'File not found' }, 404);
    }

    // Parse query params
    const w = c.req.query('w');
    const h = c.req.query('h');
    const q = c.req.query('q');
    const fmt = c.req.query('fmt') as 'jpg' | 'png' | 'webp' | 'avif' | undefined;

    const options = {
        width: w ? parseInt(w) : undefined,
        height: h ? parseInt(h) : undefined,
        quality: q ? parseInt(q) : undefined,
        format: fmt,
    };

    try {
        const stream = await storage.get(key, options);

        // Determine content type
        let contentType = 'application/octet-stream';
        if (fmt) {
            const mimeMap: Record<string, string> = {
                jpg: 'image/jpeg',
                png: 'image/png',
                webp: 'image/webp',
                avif: 'image/avif',
            };
            contentType = mimeMap[fmt] || 'image/jpeg';
        } else {
            // Guess from extension
            const ext = key.split('.').pop()?.toLowerCase();
            const extMimeMap: Record<string, string> = {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                gif: 'image/gif',
                webp: 'image/webp',
                avif: 'image/avif',
                svg: 'image/svg+xml',
            };
            contentType = extMimeMap[ext || ''] || 'application/octet-stream';
        }

        // Set cache headers
        c.header('Content-Type', contentType);
        c.header('Cache-Control', 'public, max-age=31536000, immutable');

        // Convert stream to response
        // @ts-ignore - Hono supports readable streams
        return new Response(stream, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (error) {
        console.error('Error serving file:', error);
        return c.json({ error: 'Failed to serve file' }, 500);
    }
});

export { serveRouter };
