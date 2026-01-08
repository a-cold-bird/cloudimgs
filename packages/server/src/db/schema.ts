import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ==================== Files Table ====================
export const files = sqliteTable('files', {
    id: text('id').primaryKey(), // UUID
    key: text('key').notNull().unique(), // Storage key (e.g., "2024/01/uuid.jpg")
    originalName: text('original_name').notNull(),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    thumbhash: text('thumbhash'),

    // Tags (stored as JSON array for simplicity)
    tags: text('tags', { mode: 'json' }).$type<string[]>().default([]),

    // EXIF data (stored as JSON string)
    exifData: text('exif_data', { mode: 'json' }).$type<{
        latitude?: number;
        longitude?: number;
        dateTaken?: string;
        camera?: string;
        orientation?: number;
    }>(),

    // Relations
    albumId: text('album_id').references(() => albums.id, { onDelete: 'set null' }),

    // Timestamps
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ==================== Albums Table ====================
export const albums = sqliteTable('albums', {
    id: text('id').primaryKey(), // UUID
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(), // URL-friendly name (unique for public access)
    parentId: text('parent_id').references((): any => albums.id, { onDelete: 'cascade' }),

    // Album settings
    password: text('password'), // Optional password protection
    isPublic: integer('is_public', { mode: 'boolean' }).default(false),
    coverFileId: text('cover_file_id'), // Cover image

    // Virtual path (computed from parent chain, e.g., "/photos/travel")
    path: text('path').notNull().default('/'),

    // Timestamps
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ==================== Tags Table ====================
export const tags = sqliteTable('tags', {
    id: text('id').primaryKey(), // UUID
    name: text('name').notNull().unique(), // Tag name
    slug: text('slug').notNull().unique(), // URL-friendly name
    color: text('color').default('#6366f1'), // Display color
    createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ==================== Settings Table ====================
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value'),
});

// ==================== Type Exports ====================
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

