// Environment configuration with defaults
export const config = {
    // Server
    port: parseInt(process.env.PORT || '3003'),
    host: process.env.HOST || '0.0.0.0',

    // Database
    databaseUrl: process.env.DATABASE_URL || './data/cloudimgs.db',

    // Storage
    storage: {
        type: (process.env.STORAGE_TYPE || 'local') as 'local' | 's3' | 'oss',
        basePath: process.env.STORAGE_PATH || './uploads',
        baseUrl: process.env.STORAGE_BASE_URL || '/api/files',
    },

    // Auth
    auth: {
        password: process.env.PASSWORD || null,
        enabled: !!process.env.PASSWORD,
    },

    // Upload limits
    upload: {
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE || String(50 * 1024 * 1024)), // 50MB
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
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minute
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '60'), // 60 requests per minute
        globalMaxRequests: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX || '1000'), // Global limit per minute
    },

    // Base URL for external access
    baseUrl: process.env.BASE_URL || 'http://localhost:3003',
};

export type Config = typeof config;

