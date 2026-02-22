import { Hono } from 'hono';
import { getAppSettings, updateAppSettings, type AppSettings } from '../lib/appSettings.js';
import {
    DEFAULT_ANNOTATION_PROMPT_PRESET_ID,
    listAnnotationPromptPresets,
} from '../lib/annotationPromptPresets.js';

const settingsRouter = new Hono();

function withLockedSemantic(settings: AppSettings) {
    return {
        ...settings,
        retrieval: {
            ...settings.retrieval,
            semanticSearchLocked: true,
            semanticSearchEnabled: false,
        },
    };
}

function buildModelsApiUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (/\/models$/i.test(normalized)) return normalized;
    if (/\/v1$/i.test(normalized)) return `${normalized}/models`;
    return `${normalized}/v1/models`;
}

function normalizeModelList(payload: any): string[] {
    const raw = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.models)
            ? payload.models
            : [];

    const modelIds = raw
        .map((item: any) => String(item?.id ?? item?.name ?? '').trim())
        .filter((id: string) => id.length > 0);

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of modelIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        deduped.push(id);
    }

    return deduped.sort((a, b) => a.localeCompare(b, 'en-US'));
}

settingsRouter.get('/', async (c) => {
    const data = await getAppSettings();
    return c.json({ success: true, data: withLockedSemantic(data) });
});

settingsRouter.patch('/', async (c) => {
    const body = await c.req.json<Partial<AppSettings>>();
    const updated = await updateAppSettings(body);
    return c.json({ success: true, data: withLockedSemantic(updated) });
});

settingsRouter.get('/annotation/presets', async (c) => {
    const presets = listAnnotationPromptPresets();
    return c.json({
        success: true,
        data: {
            defaultPresetId: DEFAULT_ANNOTATION_PROMPT_PRESET_ID,
            presets,
        },
    });
});

settingsRouter.post('/models', async (c) => {
    const body = await c.req.json<{ baseUrl?: string; apiKey?: string }>().catch(() => ({}));
    const saved = await getAppSettings();

    const baseUrl = String(body.baseUrl ?? saved.annotation.baseUrl ?? '').trim();
    const apiKey = String(body.apiKey ?? saved.annotation.apiKey ?? '').trim();

    if (!baseUrl || !apiKey) {
        return c.json({ success: false, error: '请先配置标注 Base URL 和 API Key' }, 400);
    }

    const apiUrl = buildModelsApiUrl(baseUrl);

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            return c.json(
                {
                    success: false,
                    error: `模型列表接口失败(${response.status}): ${text || response.statusText}`,
                },
                502,
            );
        }

        const payload = await response.json().catch(() => ({}));
        const models = normalizeModelList(payload);

        return c.json({
            success: true,
            data: {
                models,
                total: models.length,
            },
        });
    } catch (error: any) {
        return c.json(
            {
                success: false,
                error: `获取模型列表失败: ${error?.message || 'unknown error'}`,
            },
            502,
        );
    }
});

export { settingsRouter };
