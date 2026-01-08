import { Hono } from 'hono';
import type { StorageDriver } from '../drivers/interface.js';

// Will be injected via middleware
declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const serveRouter = new Hono();

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
