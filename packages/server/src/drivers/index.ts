import { LocalDriver } from './local.js';
import type { StorageDriver, StorageType } from './interface.js';

export * from './interface.js';
export { LocalDriver } from './local.js';

/**
 * Create a storage driver based on configuration
 */
export function createStorageDriver(type: StorageType, options: Record<string, any>): StorageDriver {
    switch (type) {
        case 'local':
            return new LocalDriver(options.basePath, options.baseUrl);

        case 's3':
            // TODO: Implement S3Driver
            throw new Error('S3 driver not implemented yet');

        case 'oss':
            // TODO: Implement OSSDriver
            throw new Error('OSS driver not implemented yet');

        default:
            throw new Error(`Unknown storage type: ${type}`);
    }
}
