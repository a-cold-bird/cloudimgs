export interface AnnotationPromptPreset {
    id: string;
    name: string;
    description: string;
    prompt: string;
    recommended?: boolean;
}

const CN_BALANCED_PROMPT = [
    '你是“图床检索标注助手”。目标不是写文案，而是产出可检索、低歧义、可复用的结构化标注。',
    '请只输出 1 个 JSON 对象，不要 Markdown，不要解释，不要额外文本。',
    '',
    '可用上下文（仅辅助，不可压过图像事实）：',
    '- original_name: {{original_name}}',
    '- album_name: {{album_name}}',
    '- album_id: {{album_id}}',
    '- file_id: {{file_id}}',
    '',
    '输出字段必须齐全：',
    '1) caption: 字符串',
    '- 8~20 字中文短句',
    '- 概括“主体 + 核心动作/状态 + 主情绪”',
    '',
    '2) semantic_description: 字符串',
    '- 2~5 句检索导向描述',
    '- 覆盖：画风/媒介、主体外观、动作关系、构图视角、场景要素、主要情绪',
    '- 仅描述可见信息；不确定时使用“可能/疑似”或省略',
    '',
    '3) aliases: 字符串数组',
    '- 8~20 个检索短语，每项 2~10 字',
    '- 包含：正式说法、口语说法、近义表达、动作短语、情绪短语',
    '- 去重，不要整句，不要堆砌无意义词',
    '',
    '4) tags: 字符串数组',
    '- 12~30 个关键词，每项 1~8 字',
    '- 优先高区分度：风格、主体、动作、表情、镜头、场景、色调',
    '- 中文优先，必要时可补充英文小写词',
    '',
    '硬性规则：',
    '- 只输出合法 JSON，对象键名固定为 caption, semantic_description, aliases, tags',
    '- 不得缺字段，不得输出 null',
    '- 禁止虚构不可见事实，禁止过度臆测人物身份/年龄',
].join('\n');

const CN_ANIME_EMOTION_PROMPT = [
    '你是“二次元表情检索标注助手”。请为表情图/反应图生成高命中检索标注。',
    '只输出 JSON 对象，不要输出任何解释。',
    '',
    '上下文：',
    '- original_name: {{original_name}}',
    '- album_name: {{album_name}}',
    '- album_id: {{album_id}}',
    '- file_id: {{file_id}}',
    '',
    '字段：caption, semantic_description, aliases, tags（全部必须有值）。',
    '',
    '要求：',
    '- caption：突出“情绪 + 动作/状态”，8~18 字。',
    '- semantic_description：重点写情绪触发场景、角色状态、动作细节、语气倾向。',
    '- aliases：至少 12 项，优先加入聊天常用表达（如：无语、委屈、开心到飞起、求抱抱等）。',
    '- tags：至少 16 项，覆盖情绪强度、动作类型、角色属性、画风属性。',
    '',
    '约束：',
    '- 以图像事实为准，不要把“幸福”标给明显“无奈/委屈”的图。',
    '- 同义词可多给，但不得重复或自相矛盾。',
    '- 只返回 JSON，不要代码块。',
].join('\n');

const CN_AGENT_CALL_PROMPT = [
    '你是“Agent 调图标注助手”，目标是提升 API 调图一次命中率。',
    '只输出单个 JSON 对象。',
    '',
    '上下文：',
    '- original_name: {{original_name}}',
    '- album_name: {{album_name}}',
    '- album_id: {{album_id}}',
    '- file_id: {{file_id}}',
    '',
    '输出字段：caption, semantic_description, aliases, tags。',
    '',
    '检索优化要求：',
    '- aliases 中加入“用户会输入的需求词”，例如：好幸福、想哭、被夸、摸摸头、生气了。',
    '- 同时给出“字面词”和“意图词”（如：被捏脸 + 委屈撒娇）。',
    '- tags 需包含可组合检索要素：主体词 + 动作词 + 情绪词 + 风格词。',
    '',
    '格式要求：',
    '- caption 8~20 字。',
    '- semantic_description 2~4 句。',
    '- aliases 10~24 项，tags 12~30 项。',
    '- 全部去重；只输出 JSON。',
].join('\n');

export const ANNOTATION_PROMPT_PRESETS: AnnotationPromptPreset[] = [
    {
        id: 'cn_balanced_v2',
        name: '通用检索增强',
        description: '推荐。兼顾准确性、可读性与检索命中率。',
        prompt: CN_BALANCED_PROMPT,
        recommended: true,
    },
    {
        id: 'cn_anime_emotion_v1',
        name: '二次元情绪表情',
        description: '偏重情绪、反应图、聊天语气表达。',
        prompt: CN_ANIME_EMOTION_PROMPT,
    },
    {
        id: 'cn_agent_call_v1',
        name: 'Agent 调用优先',
        description: '偏重 API 一次命中，强化意图词与别名扩展。',
        prompt: CN_AGENT_CALL_PROMPT,
    },
];

export const DEFAULT_ANNOTATION_PROMPT_PRESET_ID = 'cn_balanced_v2';

export function listAnnotationPromptPresets(): AnnotationPromptPreset[] {
    return ANNOTATION_PROMPT_PRESETS.map((item) => ({ ...item }));
}

export function findAnnotationPromptPreset(id: string): AnnotationPromptPreset | undefined {
    const key = String(id || '').trim();
    if (!key) return undefined;
    return ANNOTATION_PROMPT_PRESETS.find((item) => item.id === key);
}

export function getDefaultAnnotationPrompt(): string {
    return findAnnotationPromptPreset(DEFAULT_ANNOTATION_PROMPT_PRESET_ID)?.prompt ?? CN_BALANCED_PROMPT;
}
