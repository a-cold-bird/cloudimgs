import { dirname, isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, '..');

function toInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveServerPath(value: string | undefined, fallback: string): string {
    const raw = (value || fallback).trim();
    if (!raw) return resolve(SERVER_ROOT, fallback);
    return isAbsolute(raw) ? raw : resolve(SERVER_ROOT, raw);
}

const serverPort = toInt(process.env.SERVER_PORT || process.env.PORT, 3003);

// Environment configuration with defaults
export const config = {
    // Server
    port: serverPort,
    host: process.env.HOST || '0.0.0.0',

    // Database
    databaseUrl: resolveServerPath(process.env.DATABASE_URL, './data/cloudimgs.db'),

    // Storage
    storage: {
        type: (process.env.STORAGE_TYPE || 'local') as 'local' | 's3' | 'oss',
        basePath: resolveServerPath(process.env.STORAGE_PATH, './uploads'),
        baseUrl: process.env.STORAGE_BASE_URL || '/api/files',
    },

    // Auth
    auth: {
        password: process.env.PASSWORD || null,
        enabled: !!process.env.PASSWORD,
    },

    // Upload limits
    upload: {
        maxFileSize: toInt(process.env.MAX_FILE_SIZE, 50 * 1024 * 1024), // 50MB
        allowedMimeTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'image/avif',
            'image/svg+xml',
            'image/bmp',
        ],
    },

    // Rate limiting
    rateLimit: {
        enabled: process.env.RATE_LIMIT_ENABLED !== 'false', // Default enabled
        windowMs: toInt(process.env.RATE_LIMIT_WINDOW, 60000), // 1 minute
        maxRequests: toInt(process.env.RATE_LIMIT_MAX, 60), // 60 requests per minute
        globalMaxRequests: toInt(process.env.RATE_LIMIT_GLOBAL_MAX, 1000), // Global limit per minute
    },

    // Base URL for external access
    baseUrl: process.env.BASE_URL || `http://localhost:${serverPort}`,
};

export type Config = typeof config;

