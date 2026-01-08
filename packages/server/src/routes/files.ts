import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, like, and, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import exifr from 'exifr';
import mime from 'mime-types';
import { db } from '../db/index.js';
import { files, albums } from '../db/schema.js';
import { config } from '../config.js';
import type { StorageDriver } from '../drivers/interface.js';

// Will be injected via middleware
declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const filesRouter = new Hono();

/**
 * Generate ThumbHash for an image
 */
async function generateThumbHash(buffer: Buffer): Promise<string | null> {
    try {
        const { data, info } = await sharp(buffer)
            .resize(100, 100, { fit: 'inside' })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const { rgbaToThumbHash } = await import('thumbhash');
        const hash = rgbaToThumbHash(info.width, info.height, data);
        return Buffer.from(hash).toString('base64');
    } catch {
        return null;
    }
}

/**
 * Extract EXIF data from image
 */
async function extractExif(buffer: Buffer) {
    try {
        const exif = await exifr.parse(buffer, { gps: true });
        if (!exif) return null;

        return {
            latitude: exif.latitude,
            longitude: exif.longitude,
            dateTaken: exif.DateTimeOriginal?.toISOString() || exif.CreateDate?.toISOString(),
            camera: exif.Make ? `${exif.Make} ${exif.Model || ''}`.trim() : undefined,
            orientation: exif.Orientation,
        };
    } catch {
        return null;
    }
}

/**
 * GET /api/files
 * List all files with optional filtering
 */
filesRouter.get('/', async (c) => {
    const albumId = c.req.query('albumId');
    const search = c.req.query('q');
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = (page - 1) * limit;

    const conditions = [];
    if (albumId) {
        conditions.push(eq(files.albumId, albumId));
    } else if (c.req.query('root') === 'true') {
        conditions.push(isNull(files.albumId));
    }

    if (search) {
        conditions.push(like(files.originalName, `%${search}%`));
    }

    const results = await db
        .select()
        .from(files)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(files.createdAt))
        .limit(limit)
        .offset(offset);

    const storage = c.get('storage');

    return c.json({
        success: true,
        data: results.map((file) => ({
            ...file,
            url: storage.getUrl(file.key),
        })),
        pagination: { page, limit },
    });
});

/**
 * GET /api/files/:id
 * Get single file info
 */
filesRouter.get('/:id', async (c) => {
    const id = c.req.param('id');

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: 'File not found' }, 404);
    }

    const storage = c.get('storage');

    return c.json({
        success: true,
        data: {
            ...file,
            url: storage.getUrl(file.key),
        },
    });
});

/**
 * POST /api/files/upload
 * Upload a new file
 */
filesRouter.post('/upload', async (c) => {
    const storage = c.get('storage');
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const albumId = formData.get('albumId') as string | null;

    if (!file) {
        return c.json({ success: false, error: '没有选择文件' }, 400);
    }

    // Validate MIME type
    if (!config.upload.allowedMimeTypes.includes(file.type)) {
        return c.json({ success: false, error: '不支持的文件格式' }, 400);
    }

    // Validate file size
    if (file.size > config.upload.maxFileSize) {
        return c.json({ success: false, error: '文件大小超过限制' }, 400);
    }

    // Generate unique key
    const id = uuidv4();
    const ext = mime.extension(file.type) || 'bin';
    const date = new Date();
    const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${id}.${ext}`;

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Get image dimensions
    let width: number | undefined;
    let height: number | undefined;
    try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width;
        height = metadata.height;
    } catch {
        // Not an image or can't read metadata
    }

    // Generate thumbhash and extract EXIF
    const [thumbhash, exifData] = await Promise.all([
        generateThumbHash(buffer),
        extractExif(buffer),
    ]);

    // Store file
    await storage.put(key, buffer, file.type);

    // Save to database
    const newFile = {
        id,
        key,
        originalName: file.name,
        size: file.size,
        mimeType: file.type,
        width,
        height,
        thumbhash,
        exifData,
        albumId,
    };

    await db.insert(files).values(newFile);

    return c.json({
        success: true,
        data: {
            ...newFile,
            url: storage.getUrl(key),
        },
    });
});

/**
 * POST /api/files/upload-base64
 * Upload a base64 encoded image
 */
filesRouter.post('/upload-base64', async (c) => {
    const storage = c.get('storage');
    const body = await c.req.json<{ base64Image: string; albumId?: string; originalName?: string }>();

    if (!body.base64Image) {
        return c.json({ success: false, error: '缺少 base64Image 参数' }, 400);
    }

    // Parse base64 data
    const matches = body.base64Image.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
        return c.json({ success: false, error: '无效的 base64 格式' }, 400);
    }

    const mimeType = matches[1];
    if (!config.upload.allowedMimeTypes.includes(mimeType)) {
        return c.json({ success: false, error: '不支持的文件格式' }, 400);
    }

    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > config.upload.maxFileSize) {
        return c.json({ success: false, error: '文件大小超过限制' }, 400);
    }

    // Generate unique key
    const id = uuidv4();
    const ext = mime.extension(mimeType) || 'png';
    const date = new Date();
    const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${id}.${ext}`;

    // Get image dimensions
    let width: number | undefined;
    let height: number | undefined;
    try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width;
        height = metadata.height;
    } catch {
        // Not an image
    }

    // Generate thumbhash and extract EXIF
    const [thumbhash, exifData] = await Promise.all([
        generateThumbHash(buffer),
        extractExif(buffer),
    ]);

    // Store file
    await storage.put(key, buffer, mimeType);

    // Save to database
    const newFile = {
        id,
        key,
        originalName: body.originalName || `${id}.${ext}`,
        size: buffer.length,
        mimeType,
        width,
        height,
        thumbhash,
        exifData,
        albumId: body.albumId,
    };

    await db.insert(files).values(newFile);

    return c.json({
        success: true,
        data: {
            ...newFile,
            url: storage.getUrl(key),
        },
    });
});

/**
 * DELETE /api/files/:id
 * Delete a file
 */
filesRouter.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const storage = c.get('storage');

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: 'File not found' }, 404);
    }

    // Delete from storage
    await storage.delete(file.key);

    // Delete from database
    await db.delete(files).where(eq(files.id, id));

    return c.json({ success: true, message: '删除成功' });
});

/**
 * PATCH /api/files/:id
 * Update file metadata (e.g., move to album)
 */
filesRouter.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ albumId?: string | null; originalName?: string }>();

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: 'File not found' }, 404);
    }

    const updates: Partial<typeof file> = {
        updatedAt: new Date().toISOString(),
    };

    if ('albumId' in body) {
        updates.albumId = body.albumId;
    }
    if (body.originalName) {
        updates.originalName = body.originalName;
    }

    await db.update(files).set(updates).where(eq(files.id, id));

    return c.json({ success: true, message: '更新成功' });
});

/**
 * POST /api/files/batch/move
 * Move multiple files to an album
 */
filesRouter.post('/batch/move', async (c) => {
    const body = await c.req.json<{ fileIds: string[]; albumId: string | null }>();

    if (!body.fileIds || body.fileIds.length === 0) {
        return c.json({ success: false, error: '没有选择文件' }, 400);
    }

    for (const fileId of body.fileIds) {
        await db
            .update(files)
            .set({ albumId: body.albumId, updatedAt: new Date().toISOString() })
            .where(eq(files.id, fileId));
    }

    return c.json({ success: true, message: `成功移动 ${body.fileIds.length} 个文件` });
});

/**
 * POST /api/files/batch/delete
 * Delete multiple files
 */
filesRouter.post('/batch/delete', async (c) => {
    const body = await c.req.json<{ fileIds: string[] }>();
    const storage = c.get('storage');

    if (!body.fileIds || body.fileIds.length === 0) {
        return c.json({ success: false, error: '没有选择文件' }, 400);
    }

    for (const fileId of body.fileIds) {
        const file = await db.select().from(files).where(eq(files.id, fileId)).get();
        if (file) {
            await storage.delete(file.key);
            await db.delete(files).where(eq(files.id, fileId));
        }
    }

    return c.json({ success: true, message: `成功删除 ${body.fileIds.length} 个文件` });
});

export { filesRouter };
