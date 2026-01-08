// Load environment variables from root .env file
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load from project root .env (two levels up from packages/server/src)
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

// Global error handlers to prevent process crashes
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err.message);
    console.error(err.stack);
    // Don't exit - try to keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('Reason:', reason);
    // Don't exit - try to keep the server running
});


async function startServer() {
    const { serve } = await import('@hono/node-server');
    const { app } = await import('./app.js');
    const { config } = await import('./config.js');

    // Initialize database tables if they don't exist
    await import('./db/index.js');

    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   ☁️  CloudImgs v2.0                                  ║
║   Modern Image Hosting with SQLite                   ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);

    console.log(`📍 Starting server on http://${config.host}:${config.port}`);
    console.log(`📂 Storage path: ${config.storage.basePath}`);
    console.log(`🔒 Password protection: ${config.auth.enabled ? 'Enabled' : 'Disabled'}`);
    console.log('');

    serve({
        fetch: app.fetch,
        port: config.port,
        hostname: config.host,
    }, (info) => {
        console.log(`✅ Server running at http://${info.address}:${info.port}`);
        console.log('');
        console.log('📚 API Endpoints:');
        console.log('   GET  /api/health          - Health check');
        console.log('   GET  /api/auth/status     - Check auth status');
        console.log('   POST /api/auth/verify     - Verify password');
        console.log('   GET  /api/files           - List files');
        console.log('   POST /api/files/upload    - Upload file');
        console.log('   GET  /api/albums          - List albums');
        console.log('   POST /api/albums          - Create album');
        console.log('   GET  /api/serve/:key      - Serve file (with image processing)');
        console.log('   GET  /api/map/photos      - Get photos with GPS');
        console.log('');
    });
}

startServer();
