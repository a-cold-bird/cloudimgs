import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { auth } from './routes/auth.js';
import { filesRouter } from './routes/files.js';
import { albumsRouter } from './routes/albums.js';
import { serveRouter } from './routes/serve.js';
import { mapRouter } from './routes/map.js';
import { publicRouter } from './routes/public.js';
import { tagsRouter } from './routes/tags.js';
import { imageApiRouter } from './routes/imageApi.js';
import { watermarkRouter } from './routes/watermark.js';
import { shareRouter } from './routes/share.js';
import { settingsRouter } from './routes/settings.js';
import { config } from './config.js';
import { createStorageDriver } from './drivers/index.js';
import type { StorageDriver } from './drivers/interface.js';
import { getRateLimitStats, rateLimit } from './middleware/rateLimit.js';

// Create Hono app
const app = new Hono();

// Initialize storage driver
const storage = createStorageDriver(config.storage.type, {
    basePath: config.storage.basePath,
    baseUrl: '/api/serve',
});

// ==================== Middleware ====================

// Logger
app.use('*', logger());

// CORS
app.use('*', cors());

// Pretty JSON in development
app.use('*', prettyJSON());

// Inject storage driver into context
app.use('*', async (c, next) => {
    c.set('storage', storage);
    await next();
});

// Password protection middleware (for protected routes)
const requireAuth = async (c: any, next: any) => {
    if (!config.auth.enabled) {
        return next();
    }

    const password = c.req.header('x-access-password') || c.req.query('password');

    if (!password || password !== config.auth.password) {
        return c.json({ error: '需要提供有效的访问密码' }, 401);
    }

    await next();
};

// ==================== Routes ====================

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Auth routes (public)
app.use('/api/auth/verify', rateLimit(20));
app.route('/api/auth', auth);

// File serving (public, but album password may apply)
app.route('/api/serve', serveRouter);

// ==================== Image API (public, with rate limiting) ====================
app.route('/i', imageApiRouter);

// ==================== Public API (no auth required) ====================
app.route('/api/public', publicRouter);

// ==================== Protected routes ====================
app.use('/api/files', requireAuth);
app.use('/api/files/*', requireAuth);
app.use('/api/albums', requireAuth);
app.use('/api/albums/*', requireAuth);
app.use('/api/tags', requireAuth);
app.use('/api/tags/*', requireAuth);
app.use('/api/watermark', requireAuth);
app.use('/api/watermark/*', requireAuth);
app.use('/api/settings', requireAuth);
app.use('/api/settings/*', requireAuth);
app.use('/api/map', requireAuth);
app.use('/api/map/*', requireAuth);
app.use('/api/share/generate', requireAuth);
app.use('/api/share/list', requireAuth);
app.use('/api/share/revoke', requireAuth);
app.use('/api/share/delete', requireAuth);

app.route('/api/files', filesRouter);
app.route('/api/albums', albumsRouter);
app.route('/api/tags', tagsRouter);
app.route('/api/watermark', watermarkRouter);
app.route('/api/map', mapRouter);
app.route('/api/share', shareRouter);
app.route('/api/settings', settingsRouter);

// Rate limit stats (protected)
app.get('/api/admin/rate-limit-stats', requireAuth, (c) => {
    return c.json({ success: true, data: getRateLimitStats() });
});

// ==================== Static Files (for production) ====================

// In production, serve the Vue frontend
// This is typically handled by the build process / Dockerfile

// ==================== Error Handling ====================

app.onError((err, c) => {
    console.error(`[Error] ${err.message}`, err.stack);
    return c.json({ error: err.message || 'Internal Server Error' }, 500);
});

app.notFound((c) => {
    return c.json({ error: 'Not Found' }, 404);
});

export { app, storage };
export type { StorageDriver };


