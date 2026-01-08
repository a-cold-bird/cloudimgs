import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tags, files } from '../db/schema.js';

const tagsRouter = new Hono();

/**
 * Helper: Generate URL-friendly slug from name
 */
function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/tags
 * List all tags with file count
 */
tagsRouter.get('/', async (c) => {
    const allTags = await db.select().from(tags);
    const allFiles = await db.select({ id: files.id, tags: files.tags }).from(files);

    // Count files per tag
    const tagCounts: Record<string, number> = {};
    for (const file of allFiles) {
        const fileTags = (file.tags as string[]) || [];
        // Ensure it is an array
        if (Array.isArray(fileTags)) {
            for (const tagName of fileTags) {
                // We must convert tag name to slug to match the key used in response
                const s = slugify(tagName);
                tagCounts[s] = (tagCounts[s] || 0) + 1;
            }
        }
    }

    return c.json({
        success: true,
        data: allTags.map((tag) => ({
            ...tag,
            fileCount: tagCounts[tag.slug] || 0,
        })),
    });
});

/**
 * POST /api/tags
 * Create a new tag
 */
tagsRouter.post('/', async (c) => {
    const body = await c.req.json<{ name: string; color?: string }>();

    if (!body.name || body.name.trim() === '') {
        return c.json({ success: false, error: '标签名称不能为空' }, 400);
    }

    const id = uuidv4();
    const slug = slugify(body.name);

    // Check if slug already exists
    const existing = await db.select().from(tags).where(eq(tags.slug, slug)).get();
    if (existing) {
        return c.json({ success: false, error: '标签已存在' }, 400);
    }

    const newTag = {
        id,
        name: body.name.trim(),
        slug,
        color: body.color || '#6366f1',
    };

    await db.insert(tags).values(newTag);

    return c.json({
        success: true,
        data: newTag,
    });
});

/**
 * DELETE /api/tags/:id
 * Delete a tag (does not affect files, they keep their tag strings)
 */
tagsRouter.delete('/:id', async (c) => {
    const id = c.req.param('id');

    const tag = await db.select().from(tags).where(eq(tags.id, id)).get();

    if (!tag) {
        return c.json({ success: false, error: '标签不存在' }, 404);
    }

    await db.delete(tags).where(eq(tags.id, id));

    return c.json({ success: true, message: '删除成功' });
});

/**
 * PATCH /api/files/:id/tags
 * Update tags for a file
 */
tagsRouter.patch('/files/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ tags: string[] }>();

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: '文件不存在' }, 404);
    }

    await db
        .update(files)
        .set({ tags: body.tags, updatedAt: new Date().toISOString() })
        .where(eq(files.id, id));

    return c.json({ success: true, message: '标签更新成功' });
});

/**
 * POST /api/files/:id/tags/add
 * Add a tag to a file
 */
tagsRouter.post('/files/:id/add', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ tag: string }>();

    if (!body.tag) {
        return c.json({ success: false, error: '标签不能为空' }, 400);
    }

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: '文件不存在' }, 404);
    }

    // Check if tag exists in global tags table, if not create it
    const tagName = body.tag.trim();
    const tagSlug = slugify(tagName);

    // We try to find by slug to avoid duplicates
    const existingTag = await db.select().from(tags).where(eq(tags.slug, tagSlug)).get();

    if (!existingTag) {
        try {
            await db.insert(tags).values({
                id: uuidv4(),
                name: tagName,
                slug: tagSlug,
                color: '#6366f1' // Default color
            });
        } catch (e) {
            // Ignore insert error (race condition)
            console.error('Auto-create tag failed', e);
        }
    }

    const currentTags = (file.tags as string[]) || [];
    if (!currentTags.includes(tagName)) {
        currentTags.push(tagName);
    }

    await db
        .update(files)
        .set({ tags: currentTags, updatedAt: new Date().toISOString() })
        .where(eq(files.id, id));

    return c.json({ success: true, message: '标签添加成功', tags: currentTags });
});

/**
 * POST /api/files/:id/tags/remove
 * Remove a tag from a file
 */
tagsRouter.post('/files/:id/remove', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ tag: string }>();

    if (!body.tag) {
        return c.json({ success: false, error: '标签不能为空' }, 400);
    }

    const file = await db.select().from(files).where(eq(files.id, id)).get();

    if (!file) {
        return c.json({ success: false, error: '文件不存在' }, 404);
    }

    let currentTags = (file.tags as string[]) || [];
    currentTags = currentTags.filter((t) => t !== body.tag);

    await db
        .update(files)
        .set({ tags: currentTags, updatedAt: new Date().toISOString() })
        .where(eq(files.id, id));

    return c.json({ success: true, message: '标签移除成功', tags: currentTags });
});

export { tagsRouter };
