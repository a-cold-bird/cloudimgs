import { Hono } from 'hono';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';

const watermarkRouter = new Hono();

// Watermark config file path
const CONFIG_DIR = path.join(config.storage.basePath, 'config');
const WATERMARK_CONFIG_FILE = path.join(CONFIG_DIR, 'watermark.json');

// Default watermark config
const DEFAULT_WATERMARK_CONFIG = {
    enabled: false,
    type: 'text' as 'text' | 'image',
    text: '',
    imagePath: null as string | null,
    position: 'bottom-right',
    opacity: 0.5,
    fontSize: 24,
    fontColor: '#ffffff',
    margin: 20,
    scale: 0.2
};

interface WatermarkConfig {
    enabled: boolean;
    type: 'text' | 'image';
    text: string;
    imagePath: string | null;
    position: string;
    opacity: number;
    fontSize: number;
    fontColor: string;
    margin: number;
    scale: number;
}

/**
 * Ensure config directory exists
 */
function ensureConfigDir() {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

/**
 * Read watermark config from file
 */
function readWatermarkConfig(): WatermarkConfig {
    try {
        ensureConfigDir();
        if (fs.existsSync(WATERMARK_CONFIG_FILE)) {
            const content = fs.readFileSync(WATERMARK_CONFIG_FILE, 'utf-8');
            return { ...DEFAULT_WATERMARK_CONFIG, ...JSON.parse(content) };
        }
    } catch (e) {
        console.error('Failed to read watermark config:', e);
    }
    return { ...DEFAULT_WATERMARK_CONFIG };
}

/**
 * Write watermark config to file
 */
function writeWatermarkConfig(configData: WatermarkConfig): void {
    try {
        ensureConfigDir();
        fs.writeFileSync(WATERMARK_CONFIG_FILE, JSON.stringify(configData, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to write watermark config:', e);
        throw e;
    }
}

/**
 * GET /api/watermark/config
 * Get watermark configuration
 */
watermarkRouter.get('/config', (c) => {
    try {
        const configData = readWatermarkConfig();
        return c.json({ success: true, data: configData });
    } catch (e) {
        console.error('Failed to get watermark config:', e);
        return c.json({ success: false, error: '获取水印配置失败' }, 500);
    }
});

/**
 * POST /api/watermark/config
 * Save watermark configuration
 */
watermarkRouter.post('/config', async (c) => {
    try {
        const body = await c.req.json<Partial<WatermarkConfig>>();

        // Validate and sanitize config
        const validPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

        const validConfig: WatermarkConfig = {
            enabled: !!body.enabled,
            type: body.type === 'image' ? 'image' : 'text',
            text: body.text || '',
            imagePath: body.imagePath || null,
            position: validPositions.includes(body.position || '') ? body.position! : 'bottom-right',
            opacity: Math.max(0.1, Math.min(1, body.opacity || 0.5)),
            fontSize: Math.max(12, Math.min(72, body.fontSize || 24)),
            fontColor: body.fontColor || '#ffffff',
            margin: Math.max(0, Math.min(100, body.margin || 20)),
            scale: Math.max(0.05, Math.min(0.5, body.scale || 0.2))
        };

        writeWatermarkConfig(validConfig);

        return c.json({
            success: true,
            data: validConfig,
            message: '水印配置已保存'
        });
    } catch (e) {
        console.error('Failed to save watermark config:', e);
        return c.json({ success: false, error: '保存水印配置失败' }, 500);
    }
});

export { watermarkRouter };
