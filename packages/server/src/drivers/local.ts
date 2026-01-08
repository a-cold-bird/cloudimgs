import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { readFile, writeFile, unlink, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { Readable, PassThrough } from 'stream';
import sharp from 'sharp';
import type { StorageDriver, FileMeta, GetOptions } from './interface.js';

export class LocalDriver implements StorageDriver {
    private basePath: string;
    private baseUrl: string;

    constructor(basePath: string, baseUrl: string = '/api/files') {
        this.basePath = basePath;
        this.baseUrl = baseUrl;

        // Ensure base directory exists
        if (!existsSync(basePath)) {
            mkdirSync(basePath, { recursive: true });
        }
    }

    private getFullPath(key: string): string {
        // Prevent directory traversal
        const normalized = key.replace(/\.\./g, '').replace(/^\/+/, '');
        return join(this.basePath, normalized);
    }

    async put(key: string, content: Buffer | Readable, mimeType: string): Promise<FileMeta> {
        const fullPath = this.getFullPath(key);
        const dir = dirname(fullPath);

        // Ensure directory exists
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // Write file
        if (Buffer.isBuffer(content)) {
            await writeFile(fullPath, content);
        } else {
            await new Promise<void>((resolve, reject) => {
                const writeStream = createWriteStream(fullPath);
                content.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });
        }

        // Get file stats
        const stats = statSync(fullPath);

        return {
            key,
            size: stats.size,
            mimeType,
        };
    }

    async get(key: string, options?: GetOptions): Promise<Readable> {
        const fullPath = this.getFullPath(key);

        if (!existsSync(fullPath)) {
            throw new Error(`File not found: ${key}`);
        }

        // If no processing options or not an image, return raw stream
        if (!options || (!options.width && !options.height && !options.quality && !options.format)) {
            return createReadStream(fullPath);
        }

        // Process image with sharp - with error handling
        try {
            let transform = sharp(fullPath, {
                // Limit memory usage and concurrency
                limitInputPixels: 268402689, // 16384 x 16384
                sequentialRead: true,
            });

            // Resize if dimensions specified
            if (options.width || options.height) {
                transform = transform.resize(options.width, options.height, {
                    fit: 'inside',
                    withoutEnlargement: true,
                });
            }

            // Convert format
            if (options.format) {
                const quality = options.quality || 80;
                switch (options.format) {
                    case 'webp':
                        transform = transform.webp({ quality });
                        break;
                    case 'avif':
                        transform = transform.avif({ quality });
                        break;
                    case 'png':
                        transform = transform.png({ quality });
                        break;
                    case 'jpg':
                    default:
                        transform = transform.jpeg({ quality });
                }
            } else if (options.quality) {
                transform = transform.jpeg({ quality: options.quality });
            }

            // Important: Handle errors on the sharp stream
            const passThrough = new PassThrough();

            transform.on('error', (err) => {
                console.error(`Sharp processing error for ${key}:`, err.message);
                // Destroy the passthrough to signal the error downstream
                passThrough.destroy(err);
            });

            transform.pipe(passThrough);
            return passThrough;
        } catch (err) {
            console.error(`Failed to initialize sharp for ${key}:`, err);
            // Fallback to raw file if sharp fails to initialize
            return createReadStream(fullPath);
        }
    }

    async getBuffer(key: string): Promise<Buffer> {
        const fullPath = this.getFullPath(key);
        return readFile(fullPath);
    }

    async delete(key: string): Promise<boolean> {
        const fullPath = this.getFullPath(key);

        try {
            await unlink(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    async exists(key: string): Promise<boolean> {
        const fullPath = this.getFullPath(key);
        return existsSync(fullPath);
    }

    getUrl(key: string): string {
        return `${this.baseUrl}/${encodeURIComponent(key)}`;
    }
}
