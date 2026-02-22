import { Hono } from 'hono';
import crypto from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { albums, files } from '../db/schema.js';
import type { StorageDriver } from '../drivers/interface.js';
import {
    readShares,
    saveShares,
    refreshShareStatus,
    validateShareToken,
    getShareSignature,
} from '../lib/shareStore.js';

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const shareRouter = new Hono();

shareRouter.post('/generate', async (c) => {
    const body = await c.req.json<{ path?: string; albumId?: string; expireSeconds?: number; burnAfterReading?: boolean }>();
    const albumId = (body.albumId || body.path || '').trim();
    if (!albumId) {
        return c.json({ success: false, error: '缺少相册ID' }, 400);
    }

    const album = await db.select().from(albums).where(eq(albums.id, albumId)).get();
    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    const createdAt = Date.now();
    const token = crypto.randomBytes(24).toString('hex');
    const signature = getShareSignature(token, albumId, createdAt);
    const expireSeconds =
        typeof body.expireSeconds === 'number' && body.expireSeconds > 0
            ? Math.floor(body.expireSeconds)
            : undefined;

    const shares = await readShares();
    shares.push({
        token,
        signature,
        albumId,
        createdAt,
        expireSeconds,
        burnAfterReading: body.burnAfterReading === true,
        status: 'active',
    });
    await saveShares(shares);

    return c.json({ success: true, token, signature });
});

shareRouter.get('/list', async (c) => {
    const albumId = (c.req.query('path') || c.req.query('albumId') || '').trim();
    if (!albumId) {
        return c.json({ success: false, error: '缺少相册ID' }, 400);
    }

    const shares = await readShares();
    let changed = false;
    const updated = shares.map((s) => {
        const next = refreshShareStatus(s);
        if (next.status !== s.status) changed = true;
        return next;
    });
    if (changed) await saveShares(updated);

    const list = updated
        .filter((s) => s.albumId === albumId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({
            token: s.token,
            signature: s.signature,
            createdAt: s.createdAt,
            expireSeconds: s.expireSeconds,
            burnAfterReading: s.burnAfterReading,
            status: s.status,
        }));

    return c.json({ success: true, data: list });
});

shareRouter.post('/revoke', async (c) => {
    const body = await c.req.json<{ path?: string; albumId?: string; signature?: string }>();
    const albumId = (body.albumId || body.path || '').trim();
    const signature = (body.signature || '').trim();

    if (!albumId || !signature) {
        return c.json({ success: false, error: '缺少参数' }, 400);
    }

    const shares = await readShares();
    const target = shares.find((s) => s.albumId === albumId && s.signature === signature);
    if (!target) {
        return c.json({ success: false, error: '分享链接不存在' }, 404);
    }

    target.status = 'revoked';
    await saveShares(shares);
    return c.json({ success: true, message: '已撤销' });
});

shareRouter.delete('/delete', async (c) => {
    const body = await c.req.json<{ signature?: string }>();
    const signature = (body.signature || '').trim();
    if (!signature) return c.json({ success: false, error: '缺少 signature' }, 400);

    const shares = await readShares();
    const filtered = shares.filter((s) => s.signature !== signature);
    if (filtered.length === shares.length) {
        return c.json({ success: false, error: '分享链接不存在' }, 404);
    }
    await saveShares(filtered);
    return c.json({ success: true });
});

shareRouter.get('/access', async (c) => {
    const token = (c.req.query('token') || '').trim();
    const page = parseInt(c.req.query('page') || '1', 10);
    const pageSize = parseInt(c.req.query('pageSize') || '20', 10);
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;

    if (!token) {
        return c.json({ success: false, error: '缺少 token' }, 400);
    }

    const validation = await validateShareToken(token);
    if (!validation.ok || !validation.share || validation.index === undefined || !validation.shares) {
        return c.json({ success: false, error: validation.error || '分享校验失败' }, validation.status || 403);
    }
    const shares = validation.shares;
    const index = validation.index;
    const current = validation.share;

    const album = await db.select().from(albums).where(eq(albums.id, current.albumId)).get();
    if (!album) {
        return c.json({ success: false, error: '相册不存在' }, 404);
    }

    const albumFiles = await db
        .select()
        .from(files)
        .where(eq(files.albumId, current.albumId))
        .orderBy(desc(files.createdAt));

    const storage = c.get('storage');
    const total = albumFiles.length;
    const offset = (safePage - 1) * safePageSize;
    const sliced = albumFiles.slice(offset, offset + safePageSize);
    const shareTokenParam = encodeURIComponent(token);

    const data = sliced.map((item) => {
        const baseUrl = storage.getUrl(item.key);
        const sep = baseUrl.includes('?') ? '&' : '?';
        return {
            filename: item.originalName,
            url: `${baseUrl}${sep}shareToken=${shareTokenParam}`,
            relPath: item.key,
            uploadTime: item.createdAt,
            size: item.size,
            thumbhash: item.thumbhash,
        };
    });

    if (current.burnAfterReading) {
        shares[index] = {
            ...current,
            status: 'burned',
            burnedAt: Date.now(),
        };
        await saveShares(shares);
    }

    return c.json({
        success: true,
        dirName: album.name,
        data,
        pagination: {
            current: safePage,
            pageSize: safePageSize,
            total,
            totalPages: Math.max(1, Math.ceil(total / safePageSize)),
        },
    });
});

export { shareRouter };
