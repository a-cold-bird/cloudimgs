import type { Readable } from 'stream';

/**
 * File metadata returned after upload
 */
export interface FileMeta {
    key: string;
    size: number;
    mimeType: string;
}

/**
 * Options for getting a file
 */
export interface GetOptions {
    // Image processing options (for image files)
    width?: number;
    height?: number;
    quality?: number;
    format?: 'jpg' | 'png' | 'webp' | 'avif';
}

/**
 * Storage Driver Interface
 * Implement this interface to support different storage backends (Local, S3, OSS, etc.)
 */
export interface StorageDriver {
    /**
     * Store a file
     * @param key Storage key (path)
     * @param content File content as Buffer or Stream
     * @param mimeType MIME type of the file
     */
    put(key: string, content: Buffer | Readable, mimeType: string): Promise<FileMeta>;

    /**
     * Get a file as a readable stream
     * @param key Storage key
     * @param options Optional processing options
     */
    get(key: string, options?: GetOptions): Promise<Readable>;

    /**
     * Get a file as a Buffer (for small files or processing)
     * @param key Storage key
     */
    getBuffer(key: string): Promise<Buffer>;

    /**
     * Delete a file
     * @param key Storage key
     */
    delete(key: string): Promise<boolean>;

    /**
     * Check if a file exists
     * @param key Storage key
     */
    exists(key: string): Promise<boolean>;

    /**
     * Get the public URL of a file
     * @param key Storage key
     */
    getUrl(key: string): string;

    /**
     * Get a signed/temporary URL (for private files)
     * Only required for cloud storage drivers
     */
    getSignedUrl?(key: string, expiresIn?: number): Promise<string>;
}

/**
 * Storage driver type
 */
export type StorageType = 'local' | 's3' | 'oss';
