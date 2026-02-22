import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
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
const sqlite: BetterSqliteDatabase = new Database(DATABASE_PATH);
sqlite.pragma('journal_mode = WAL'); // Better concurrent performance
sqlite.pragma('foreign_keys = ON');

function ensureFilesColumns() {
    const columns = sqlite.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('caption')) {
        sqlite.exec("ALTER TABLE files ADD COLUMN caption text");
    }
    if (!columnNames.has('semantic_description')) {
        sqlite.exec("ALTER TABLE files ADD COLUMN semantic_description text");
    }
    if (!columnNames.has('aliases')) {
        sqlite.exec("ALTER TABLE files ADD COLUMN aliases text DEFAULT '[]'");
    }
    if (!columnNames.has('annotation_updated_at')) {
        sqlite.exec("ALTER TABLE files ADD COLUMN annotation_updated_at text");
    }
}

ensureFilesColumns();

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export for direct SQLite access if needed
export { sqlite };
