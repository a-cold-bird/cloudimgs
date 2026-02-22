import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { settings } from '../db/schema.js';
import {
    DEFAULT_ANNOTATION_PROMPT_PRESET_ID,
    findAnnotationPromptPreset,
    getDefaultAnnotationPrompt,
} from './annotationPromptPresets.js';

export interface AnnotationConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    promptPresetId: string;
    prompt: string;
    concurrency: number;
}

export interface RetrievalConfig {
    ruleSearchEnabled: boolean;
    semanticSearchEnabled: boolean;
}

export interface AppSettings {
    annotation: AnnotationConfig;
    retrieval: RetrievalConfig;
}

const SETTINGS_KEY = 'app_settings';
const CACHE_TTL_MS = 5000;

const DEFAULT_SETTINGS: AppSettings = {
    annotation: {
        baseUrl: '',
        apiKey: '',
        model: process.env.ANNOTATION_MODEL || 'gpt-4o-mini',
        promptPresetId: DEFAULT_ANNOTATION_PROMPT_PRESET_ID,
        prompt: getDefaultAnnotationPrompt(),
        concurrency: 2,
    },
    retrieval: {
        ruleSearchEnabled: true,
        semanticSearchEnabled: false,
    },
};

let cacheValue: AppSettings | null = null;
let cacheAt = 0;

function clampConcurrency(value: unknown): number {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.annotation.concurrency;
    return Math.min(10, Math.max(1, n));
}

function sanitizeSettings(input: Partial<AppSettings> | undefined): AppSettings {
    const rawPresetId = String(input?.annotation?.promptPresetId ?? DEFAULT_SETTINGS.annotation.promptPresetId).trim();
    const promptPresetId = findAnnotationPromptPreset(rawPresetId)
        ? rawPresetId
        : DEFAULT_SETTINGS.annotation.promptPresetId;
    const fallbackPrompt = findAnnotationPromptPreset(promptPresetId)?.prompt ?? DEFAULT_SETTINGS.annotation.prompt;
    const rawPrompt = String(input?.annotation?.prompt ?? '');
    const prompt = rawPrompt.trim().length > 0 ? rawPrompt : fallbackPrompt;

    return {
        annotation: {
            baseUrl: (input?.annotation?.baseUrl ?? DEFAULT_SETTINGS.annotation.baseUrl).trim(),
            apiKey: String(input?.annotation?.apiKey ?? DEFAULT_SETTINGS.annotation.apiKey),
            model: String(input?.annotation?.model ?? DEFAULT_SETTINGS.annotation.model).trim() || DEFAULT_SETTINGS.annotation.model,
            promptPresetId,
            prompt,
            concurrency: clampConcurrency(input?.annotation?.concurrency),
        },
        retrieval: {
            ruleSearchEnabled: Boolean(
                input?.retrieval?.ruleSearchEnabled ?? DEFAULT_SETTINGS.retrieval.ruleSearchEnabled,
            ),
            // Semantic retrieval remains locked for now.
            semanticSearchEnabled: false,
        },
    };
}

function deepMergeSettings(current: AppSettings, patch?: Partial<AppSettings>): AppSettings {
    if (!patch) return current;
    return sanitizeSettings({
        annotation: {
            ...current.annotation,
            ...patch.annotation,
        },
        retrieval: {
            ...current.retrieval,
            ...patch.retrieval,
        },
    });
}

export async function getAppSettings(force = false): Promise<AppSettings> {
    if (!force && cacheValue && Date.now() - cacheAt < CACHE_TTL_MS) {
        return cacheValue;
    }

    const row = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
    if (!row?.value) {
        cacheValue = DEFAULT_SETTINGS;
        cacheAt = Date.now();
        return DEFAULT_SETTINGS;
    }

    try {
        const parsed = JSON.parse(row.value) as Partial<AppSettings>;
        const value = deepMergeSettings(DEFAULT_SETTINGS, parsed);
        cacheValue = value;
        cacheAt = Date.now();
        return value;
    } catch {
        cacheValue = DEFAULT_SETTINGS;
        cacheAt = Date.now();
        return DEFAULT_SETTINGS;
    }
}

export async function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await getAppSettings(true);
    const next = deepMergeSettings(current, patch);

    await db
        .insert(settings)
        .values({
            key: SETTINGS_KEY,
            value: JSON.stringify(next),
        })
        .onConflictDoUpdate({
            target: settings.key,
            set: { value: JSON.stringify(next) },
        });

    cacheValue = next;
    cacheAt = Date.now();
    return next;
}
