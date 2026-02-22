import crypto from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

export type ShareStatus = 'active' | 'expired' | 'revoked' | 'burned';

export interface ShareRecord {
    token: string;
    signature: string;
    albumId: string;
    createdAt: number;
    expireSeconds?: number;
    burnAfterReading?: boolean;
    status: ShareStatus;
    burnedAt?: number;
}

interface ShareValidationOptions {
    albumId?: string;
    allowBurnedMedia?: boolean;
}

interface ShareValidationResult {
    ok: boolean;
    status: number;
    error?: string;
    share?: ShareRecord;
    shares?: ShareRecord[];
    index?: number;
}

const SHARE_FILE = 'shares.json';
const DEFAULT_BURNED_MEDIA_GRACE_MS = 5 * 60 * 1000;
const SHARE_MEDIA_BURNED_GRACE_MS = Number.isFinite(Number.parseInt(process.env.SHARE_MEDIA_BURNED_GRACE_MS || '', 10))
    ? Number.parseInt(process.env.SHARE_MEDIA_BURNED_GRACE_MS || '', 10)
    : DEFAULT_BURNED_MEDIA_GRACE_MS;
const SHARE_SECRET = process.env.SHARE_SECRET || process.env.PASSWORD || 'cloudimgs-share';

export function getShareSignature(token: string, albumId: string, createdAt: number): string {
    return crypto
        .createHmac('sha256', SHARE_SECRET)
        .update(`${token}:${albumId}:${createdAt}`)
        .digest('hex');
}

export function getShareFilePath(): string {
    return path.join(config.storage.basePath, 'config', SHARE_FILE);
}

export async function readShares(): Promise<ShareRecord[]> {
    const filePath = getShareFilePath();
    if (!existsSync(filePath)) return [];

    try {
        const content = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? (parsed as ShareRecord[]) : [];
    } catch (err) {
        console.error('Failed to read shares:', err);
        return [];
    }
}

export async function saveShares(data: ShareRecord[]): Promise<void> {
    const filePath = getShareFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function refreshShareStatus(item: ShareRecord): ShareRecord {
    if (item.status !== 'active') return item;
    if (item.expireSeconds && item.expireSeconds > 0) {
        const expiresAt = item.createdAt + item.expireSeconds * 1000;
        if (Date.now() > expiresAt) {
            return { ...item, status: 'expired' };
        }
    }
    return item;
}

function withinBurnedGrace(item: ShareRecord): boolean {
    if (!item.burnedAt || item.burnedAt <= 0) return false;
    return Date.now() - item.burnedAt <= SHARE_MEDIA_BURNED_GRACE_MS;
}

function hasValidShareSignature(item: ShareRecord): boolean {
    const expected = getShareSignature(item.token, item.albumId, item.createdAt);
    return expected === item.signature;
}

export async function validateShareToken(token: string, options: ShareValidationOptions = {}): Promise<ShareValidationResult> {
    if (!token || !token.trim()) {
        return { ok: false, status: 400, error: '缺少 token' };
    }

    const shares = await readShares();
    const index = shares.findIndex((s) => s.token === token);
    if (index === -1) {
        return { ok: false, status: 404, error: '分享链接不存在' };
    }

    const current = refreshShareStatus(shares[index]);
    if (current.status !== shares[index].status) {
        shares[index] = current;
        await saveShares(shares);
    }

    if (!hasValidShareSignature(current)) {
        return { ok: false, status: 403, error: '分享令牌校验失败' };
    }

    if (options.albumId && options.albumId !== current.albumId) {
        return { ok: false, status: 403, error: '分享令牌与资源不匹配' };
    }

    if (current.status === 'revoked') {
        return { ok: false, status: 403, error: '分享链接已撤销' };
    }
    if (current.status === 'expired') {
        return { ok: false, status: 410, error: '分享链接已过期' };
    }
    if (current.status === 'burned') {
        if (options.allowBurnedMedia && withinBurnedGrace(current)) {
            return { ok: true, status: 200, share: current, shares, index };
        }
        return { ok: false, status: 410, error: '分享链接已失效' };
    }

    return { ok: true, status: 200, share: current, shares, index };
}

