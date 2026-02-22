import { Hono } from 'hono';
import { config } from '../config.js';
import { clearPasswordAuthCookie, setPasswordAuthCookie } from '../lib/authCookie.js';

const auth = new Hono();

/**
 * GET /api/auth/status
 * Check if password protection is enabled
 */
auth.get('/status', (c) => {
    return c.json({
        requiresPassword: config.auth.enabled,
    });
});

/**
 * POST /api/auth/verify
 * Verify password
 */
auth.post('/verify', async (c) => {
    const body = await c.req.json<{ password?: string }>();
    const password = body.password;

    if (!config.auth.enabled) {
        return c.json({ success: true });
    }

    if (!password) {
        return c.json({ success: false, error: '请输入密码' }, 400);
    }

    if (password === config.auth.password) {
        setPasswordAuthCookie(c);
        return c.json({ success: true });
    }

    return c.json({ success: false, error: '密码错误' }, 401);
});

/**
 * POST /api/auth/logout
 * Logout (stateless token mode, client-side token should be cleared)
 */
auth.post('/logout', (c) => {
    clearPasswordAuthCookie(c);
    return c.json({ success: true });
});

export { auth };
