import { Hono } from 'hono';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { isNotNull, and } from 'drizzle-orm';
import type { StorageDriver } from '../drivers/interface.js';

declare module 'hono' {
    interface ContextVariableMap {
        storage: StorageDriver;
    }
}

const mapRouter = new Hono();

/**
 * GET /api/map/photos
 * Get all photos with GPS coordinates for map view
 */
mapRouter.get('/photos', async (c) => {
    const storage = c.get('storage');

    // Query files with GPS data
    const results = await db
        .select({
            id: files.id,
            key: files.key,
            originalName: files.originalName,
            thumbhash: files.thumbhash,
            exifData: files.exifData,
            createdAt: files.createdAt,
        })
        .from(files)
        .where(isNotNull(files.exifData));

    // Filter and transform
    const photosWithGps = results
        .filter((file) => {
            const exif = file.exifData as any;
            return exif?.latitude && exif?.longitude;
        })
        .map((file) => {
            const exif = file.exifData as any;
            return {
                id: file.id,
                filename: file.originalName,
                thumbUrl: `${storage.getUrl(file.key)}?w=200`,
                thumbhash: file.thumbhash,
                lat: exif.latitude,
                lng: exif.longitude,
                date: exif.dateTaken || file.createdAt,
            };
        });

    return c.json({
        success: true,
        data: photosWithGps,
    });
});

/**
 * GET /api/map/random
 * Get a random image (for random image API) 
 */
mapRouter.get('/random', async (c) => {
    const storage = c.get('storage');
    const count = await db.select({ id: files.id }).from(files);

    if (count.length === 0) {
        return c.json({ error: 'No images found' }, 404);
    }

    const randomIndex = Math.floor(Math.random() * count.length);
    const randomFile = await db.select().from(files).limit(1).offset(randomIndex).get();

    if (!randomFile) {
        return c.json({ error: 'No images found' }, 404);
    }

    // Redirect to the image
    const url = storage.getUrl(randomFile.key);
    return c.redirect(url);
});

export { mapRouter };
