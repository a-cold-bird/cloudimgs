import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';

const DATABASE_PATH = config.databaseUrl;

// Ensure data directory exists
const dbDir = dirname(DATABASE_PATH);
if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
}

// Create SQLite connection
const sqlite: BetterSqliteDatabase = new Database(DATABASE_PATH);
sqlite.pragma('journal_mode = WAL'); // Better concurrent performance
sqlite.pragma('foreign_keys = ON');

function ensureBaseTables() {
    sqlite.exec(`
CREATE TABLE IF NOT EXISTS albums (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    parent_id text,
    password text,
    is_public integer DEFAULT false,
    cover_file_id text,
    path text DEFAULT '/' NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES albums(id) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS files (
    id text PRIMARY KEY NOT NULL,
    key text NOT NULL,
    original_name text NOT NULL,
    size integer NOT NULL,
    mime_type text NOT NULL,
    width integer,
    height integer,
    thumbhash text,
    tags text DEFAULT '[]',
    caption text,
    semantic_description text,
    aliases text DEFAULT '[]',
    annotation_updated_at text,
    exif_data text,
    album_id text,
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (album_id) REFERENCES albums(id) ON UPDATE no action ON DELETE set null
);

CREATE TABLE IF NOT EXISTS tags (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    color text DEFAULT '#6366f1',
    created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key text PRIMARY KEY NOT NULL,
    value text
);

CREATE UNIQUE INDEX IF NOT EXISTS files_key_unique ON files (key);
CREATE UNIQUE INDEX IF NOT EXISTS albums_slug_unique ON albums (slug);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_unique ON tags (name);
CREATE UNIQUE INDEX IF NOT EXISTS tags_slug_unique ON tags (slug);
`);
}

function ensureFilesColumns() {
    const columns = sqlite.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has('tags')) {
        sqlite.exec("ALTER TABLE files ADD COLUMN tags text DEFAULT '[]'");
    }
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

ensureBaseTables();
ensureFilesColumns();

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

// Export for direct SQLite access if needed
export { sqlite };
