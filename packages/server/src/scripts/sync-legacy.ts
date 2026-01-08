/**
 * Migration script: Sync existing files from uploads directory to SQLite database
 * Run: npx tsx src/scripts/sync-legacy.ts
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname, extname, basename } from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import exifr from 'exifr';
import mime from 'mime-types';
import { db } from '../db/index.js';
import { files, albums } from '../db/schema.js';
import { config } from '../config.js';

const UPLOADS_PATH = config.storage.basePath;
const CACHE_DIR = '.cache';
const CONFIG_DIR = 'config';
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.svg'];

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
 * Process a single file
 */
async function processFile(filePath: string, relPath: string, albumId: string | null) {
    const ext = extname(filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return null;
    }

    const stats = statSync(filePath);
    const buffer = await readFile(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';

    // Generate key for storage (using the relative path)
    const key = relPath.replace(/\\/g, '/');

    // Check if already exists in database
    const existing = await db.select().from(files).where((f: any) => f.key.equals(key)).get();
    if (existing) {
        console.log(`  ⏭️  Skipped (already exists): ${relPath}`);
        return null;
    }

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

    const id = uuidv4();
    const newFile = {
        id,
        key,
        originalName: basename(filePath),
        size: stats.size,
        mimeType,
        width,
        height,
        thumbhash,
        exifData,
        albumId,
        createdAt: stats.mtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
    };

    await db.insert(files).values(newFile);
    console.log(`  ✅ Imported: ${relPath}`);
    return newFile;
}

/**
 * Process a directory (create album and process files)
 */
async function processDirectory(
    dirPath: string,
    relPath: string,
    parentAlbumId: string | null
): Promise<{ files: number; albums: number }> {
    const result = { files: 0, albums: 0 };
    const entries = readdirSync(dirPath);

    // Create album for this directory (if not root)
    let albumId = parentAlbumId;
    if (relPath) {
        const dirName = basename(dirPath);
        const slug = dirName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-');
        const parentPath = parentAlbumId ? (await db.select().from(albums).where((a: any) => a.id.equals(parentAlbumId)).get())?.path || '/' : '/';
        const path = parentPath === '/' ? `/${slug}` : `${parentPath}/${slug}`;

        const id = uuidv4();
        await db.insert(albums).values({
            id,
            name: dirName,
            slug,
            parentId: parentAlbumId,
            path,
        });
        albumId = id;
        result.albums++;
        console.log(`📁 Created album: ${path}`);
    }

    for (const entry of entries) {
        // Skip hidden directories
        if (entry.startsWith('.') || entry === CACHE_DIR || entry === CONFIG_DIR) {
            continue;
        }

        const entryPath = join(dirPath, entry);
        const entryRelPath = relPath ? join(relPath, entry) : entry;
        const stat = statSync(entryPath);

        if (stat.isDirectory()) {
            const subResult = await processDirectory(entryPath, entryRelPath, albumId);
            result.files += subResult.files;
            result.albums += subResult.albums;
        } else {
            const file = await processFile(entryPath, entryRelPath, albumId);
            if (file) {
                result.files++;
            }
        }
    }

    return result;
}

/**
 * Main migration function
 */
async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║   🔄 CloudImgs Legacy Data Migration                  ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📂 Scanning: ${UPLOADS_PATH}`);
    console.log('');

    if (!existsSync(UPLOADS_PATH)) {
        console.log('❌ Uploads directory not found!');
        process.exit(1);
    }

    const startTime = Date.now();
    const result = await processDirectory(UPLOADS_PATH, '', null);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Migration completed in ${elapsed}s`);
    console.log(`   📁 Albums created: ${result.albums}`);
    console.log(`   🖼️  Files imported: ${result.files}`);
    console.log('');
}

main().catch(console.error);
