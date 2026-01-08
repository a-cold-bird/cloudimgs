import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DATABASE_PATH = process.env.DATABASE_URL || './data/cloudimgs.db';

// Ensure data directory exists
const dbDir = dirname(DATABASE_PATH);
if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite = new Database(DATABASE_PATH);
sqlite.pragma('journal_mode = WAL'); // Better concurrent performance

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export for direct SQLite access if needed
export { sqlite };
