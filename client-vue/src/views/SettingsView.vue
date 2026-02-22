<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Moon, Sun, LogOut, RefreshCw, Globe, Save, Wand2 } from 'lucide-vue-next'
import { setLocale } from '@/i18n'
import api from '@/services/api'

interface AppSettingsPayload {
  annotation?: {
    baseUrl?: string
    apiKey?: string
    model?: string
    promptPresetId?: string
    prompt?: string
    concurrency?: number
  }
  retrieval?: {
    ruleSearchEnabled?: boolean
    semanticSearchEnabled?: boolean
    semanticSearchLocked?: boolean
  }
}

interface AnnotationPromptPresetOption {
  id: string
  name: string
  description: string
  prompt: string
  recommended?: boolean
}

const { t, locale } = useI18n()
const authStore = useAuthStore()

const isDark = ref(false)
const settingsLoading = ref(false)
const settingsSaving = ref(false)
const modelLoading = ref(false)
const promptPresetLoading = ref(false)

const annotationBaseUrl = ref('')
const annotationApiKey = ref('')
const annotationModel = ref('gpt-4o-mini')
const annotationPromptPresetId = ref('cn_balanced_v2')
const annotationPrompt = ref('')
const annotationConcurrency = ref(2)
const modelOptions = ref<string[]>([])
const promptPresetOptions = ref<AnnotationPromptPresetOption[]>([])

const ruleSearchEnabled = ref(true)
const semanticSearchEnabled = ref(false)
const semanticSearchLocked = ref(true)

const mergedModelOptions = computed(() => {
  const set = new Set<string>()
  for (const item of modelOptions.value) {
    const value = String(item || '').trim()
    if (value) set.add(value)
  }
  const selected = annotationModel.value.trim()
  if (selected) set.add(selected)
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en-US'))
})

const selectedPromptPreset = computed(() => {
  return promptPresetOptions.value.find((item) => item.id === annotationPromptPresetId.value) || null
})

function applyThemeFromStorage() {
  const stored = localStorage.getItem('theme')
  if (stored === 'dark') {
    isDark.value = true
    document.documentElement.classList.add('dark')
    return
  }

  if (stored === 'light') {
    isDark.value = false
    document.documentElement.classList.remove('dark')
    return
  }

  isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (isDark.value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

function handleDarkModeChange(checked: boolean) {
  isDark.value = checked
  if (checked) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

function toggleLanguage() {
  const newLocale = locale.value === 'zh' ? 'en' : 'zh'
  setLocale(newLocale)
}

function clearCache() {
  localStorage.removeItem('cached_albums')
  localStorage.removeItem('cached_tags')
  toast.success(t('settings.cacheCleared'))
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 2
  return Math.min(10, Math.max(1, Math.round(value)))
}

function normalizeModelOptions(models: unknown): string[] {
  if (!Array.isArray(models)) return []
  const set = new Set<string>()
  for (const item of models) {
    const value = String(item || '').trim()
    if (value) set.add(value)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en-US'))
}

function normalizePromptPresetOptions(payload: unknown): AnnotationPromptPresetOption[] {
  if (!Array.isArray(payload)) return []

  const options: AnnotationPromptPresetOption[] = []
  const seen = new Set<string>()

  for (const item of payload) {
    const preset = item as any
    const id = String(preset?.id || '').trim()
    const name = String(preset?.name || '').trim()
    const description = String(preset?.description || '').trim()
    const prompt = String(preset?.prompt || '')

    if (!id || !name || !prompt || seen.has(id)) continue
    seen.add(id)

    options.push({
      id,
      name,
      description,
      prompt,
      recommended: preset?.recommended === true,
    })
  }

  return options
}

function applySettings(data?: AppSettingsPayload) {
  annotationBaseUrl.value = data?.annotation?.baseUrl || ''
  annotationApiKey.value = data?.annotation?.apiKey || ''
  annotationModel.value = data?.annotation?.model || 'gpt-4o-mini'
  annotationPromptPresetId.value = data?.annotation?.promptPresetId || annotationPromptPresetId.value
  annotationPrompt.value = data?.annotation?.prompt || ''
  annotationConcurrency.value = clampConcurrency(Number(data?.annotation?.concurrency ?? 2))

  ruleSearchEnabled.value = data?.retrieval?.ruleSearchEnabled !== false
  semanticSearchEnabled.value = data?.retrieval?.semanticSearchEnabled === true
  semanticSearchLocked.value = data?.retrieval?.semanticSearchLocked !== false
}

async function loadSettings() {
  settingsLoading.value = true
  try {
    const res = await api.get('/settings')
    applySettings(res.data?.data)
  } catch (error) {
    console.error('Failed to load settings:', error)
    toast.error('加载设置失败')
  } finally {
    settingsLoading.value = false
  }
}

async function loadPromptPresets() {
  promptPresetLoading.value = true
  try {
    const res = await api.get('/settings/annotation/presets')
    const presets = normalizePromptPresetOptions(res.data?.data?.presets)
    const defaultPresetId = String(res.data?.data?.defaultPresetId || '').trim()
    promptPresetOptions.value = presets

    const hasCurrent = presets.some((item) => item.id === annotationPromptPresetId.value)
    if (!hasCurrent) {
      annotationPromptPresetId.value = defaultPresetId || presets[0]?.id || annotationPromptPresetId.value
    }
  } catch (error) {
    console.error('Failed to load prompt presets:', error)
    toast.error('加载 Prompt 预设失败')
  } finally {
    promptPresetLoading.value = false
  }
}

function applyPromptPreset() {
  const preset = promptPresetOptions.value.find((item) => item.id === annotationPromptPresetId.value)
  if (!preset) {
    toast.error('请选择可用的 Prompt 预设')
    return
  }

  annotationPrompt.value = preset.prompt
  toast.success(`已应用预设：${preset.name}`)
}

async function fetchAnnotationModels() {
  if (!annotationBaseUrl.value.trim() || !annotationApiKey.value.trim()) {
    toast.error('请先填写 Base URL 和 API Key')
    return
  }

  modelLoading.value = true
  try {
    const res = await api.post('/settings/models', {
      baseUrl: annotationBaseUrl.value.trim(),
      apiKey: annotationApiKey.value,
    })

    const models = normalizeModelOptions(res.data?.data?.models)
    modelOptions.value = models

    if (models.length === 0) {
      toast.warning('模型列表为空，请确认供应商返回格式')
      return
    }

    if (!annotationModel.value.trim() || !models.includes(annotationModel.value.trim())) {
      const firstModel = models[0] ?? ''
      if (firstModel) {
        annotationModel.value = firstModel
      }
    }

    toast.success(`已获取 ${models.length} 个模型`)
  } catch (error: any) {
    console.error('Failed to fetch model list:', error)
    const message = error?.response?.data?.error || error?.message || '获取模型列表失败'
    toast.error(message)
  } finally {
    modelLoading.value = false
  }
}

async function saveSettings() {
  settingsSaving.value = true
  try {
    const res = await api.patch('/settings', {
      annotation: {
        baseUrl: annotationBaseUrl.value.trim(),
        apiKey: annotationApiKey.value,
        model: annotationModel.value.trim() || 'gpt-4o-mini',
        promptPresetId: annotationPromptPresetId.value.trim() || 'cn_balanced_v2',
        prompt: annotationPrompt.value,
        concurrency: clampConcurrency(annotationConcurrency.value),
      },
      retrieval: {
        ruleSearchEnabled: ruleSearchEnabled.value,
        semanticSearchEnabled: semanticSearchEnabled.value,
      },
    })

    applySettings(res.data?.data)
    toast.success('设置已保存')
  } catch (error) {
    console.error('Failed to save settings:', error)
    toast.error('保存设置失败')
  } finally {
    settingsSaving.value = false
  }
}

onMounted(async () => {
  applyThemeFromStorage()
  await Promise.all([loadSettings(), loadPromptPresets()])
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">{{ t('settings.title') }}</h1>
      <p class="text-muted-foreground">{{ t('settings.description') }}</p>
    </div>

    <div class="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.appearance') }}</CardTitle>
          <CardDescription>{{ t('settings.appearanceDesc') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">{{ t('settings.darkMode') }}</p>
              <p class="text-sm text-muted-foreground">{{ t('settings.darkModeDesc') }}</p>
            </div>
            <Button variant="outline" size="sm" @click="handleDarkModeChange(!isDark)">
              <Sun v-if="isDark" class="mr-2 h-4 w-4" />
              <Moon v-else class="mr-2 h-4 w-4" />
              {{ isDark ? t('settings.lightMode') : t('settings.darkMode') }}
            </Button>
          </div>

          <Separator />

          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">{{ t('settings.language') }}</p>
              <p class="text-sm text-muted-foreground">{{ t('settings.languageDesc') }}</p>
            </div>
            <Button variant="outline" size="sm" @click="toggleLanguage">
              <Globe class="mr-2 h-4 w-4" />
              {{ locale === 'zh' ? t('settings.english') : t('settings.chinese') }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>标注配置</CardTitle>
          <CardDescription>
            配置用于图片标注的多模态接口（Base URL / API Key / Model / Prompt），并设置并发数。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">Base URL</label>
              <Input
                v-model="annotationBaseUrl"
                placeholder="例如: https://api.openai.com/v1"
                :disabled="settingsLoading || settingsSaving || modelLoading || promptPresetLoading"
              />
            </div>

            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">API Key</label>
              <Input
                v-model="annotationApiKey"
                type="password"
                placeholder="sk-..."
                :disabled="settingsLoading || settingsSaving || modelLoading || promptPresetLoading"
              />
            </div>

            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">模型列表</label>
              <div class="flex gap-2">
                <select
                  v-model="annotationModel"
                  class="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  :disabled="settingsLoading || settingsSaving || modelLoading || promptPresetLoading"
                >
                  <option v-if="mergedModelOptions.length === 0" value="">暂无模型，请先获取列表</option>
                  <option v-for="model in mergedModelOptions" :key="model" :value="model">{{ model }}</option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  :disabled="settingsLoading || settingsSaving || modelLoading || promptPresetLoading"
                  @click="fetchAnnotationModels"
                >
                  <RefreshCw class="mr-2 h-4 w-4" />
                  {{ modelLoading ? '获取中...' : '获取模型列表' }}
                </Button>
              </div>
              <p class="text-xs text-muted-foreground">若列表为空，可在下方手动输入模型名。</p>
            </div>

            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">手动模型名</label>
              <Input
                v-model="annotationModel"
                placeholder="例如: gpt-4o-mini 或你渠道可用的模型"
                :disabled="settingsLoading || settingsSaving || modelLoading || promptPresetLoading"
              />
            </div>

            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">Prompt 预设</label>
              <div class="flex gap-2">
                <select
                  v-model="annotationPromptPresetId"
                  class="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  :disabled="settingsLoading || settingsSaving || promptPresetLoading"
                >
                  <option v-if="promptPresetOptions.length === 0" value="">暂无预设，请先刷新</option>
                  <option v-for="preset in promptPresetOptions" :key="preset.id" :value="preset.id">
                    {{ preset.recommended ? `★ ${preset.name}` : preset.name }}
                  </option>
                </select>
                <Button
                  type="button"
                  variant="outline"
                  :disabled="settingsLoading || settingsSaving || promptPresetLoading"
                  @click="loadPromptPresets"
                >
                  <RefreshCw class="mr-2 h-4 w-4" />
                  {{ promptPresetLoading ? '刷新中...' : '刷新预设' }}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  :disabled="settingsLoading || settingsSaving || promptPresetLoading || promptPresetOptions.length === 0"
                  @click="applyPromptPreset"
                >
                  <Wand2 class="mr-2 h-4 w-4" />
                  应用预设
                </Button>
              </div>
              <p class="text-xs text-muted-foreground" v-if="selectedPromptPreset">
                {{ selectedPromptPreset.description }}
              </p>
            </div>

            <div class="space-y-2 md:col-span-2">
              <label class="text-sm font-medium">标注 Prompt</label>
              <textarea
                v-model="annotationPrompt"
                class="min-h-[220px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="请填写用于图片标注的系统/用户提示词模板"
                :disabled="settingsLoading || settingsSaving"
              />
              <p class="text-xs text-muted-foreground">
                可用变量：&#123;&#123;original_name&#125;&#125;、&#123;&#123;album_name&#125;&#125;、&#123;&#123;album_id&#125;&#125;、&#123;&#123;file_id&#125;&#125;
              </p>
            </div>

            <div class="space-y-2 md:col-span-1">
              <label class="text-sm font-medium">并发数 (1-10)</label>
              <Input
                v-model.number="annotationConcurrency"
                type="number"
                min="1"
                max="10"
                :disabled="settingsLoading || settingsSaving"
              />
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button :disabled="settingsLoading || settingsSaving" @click="saveSettings">
              <Save class="mr-2 h-4 w-4" />
              {{ settingsSaving ? '保存中...' : '保存标注配置' }}
            </Button>
            <Button variant="outline" :disabled="settingsLoading || settingsSaving" @click="loadSettings">
              <RefreshCw class="mr-2 h-4 w-4" />
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>检索策略</CardTitle>
          <CardDescription>
            控制 `/i` 接口使用规则检索与语义检索的行为。
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center justify-between rounded-md border p-3">
            <div class="space-y-1">
              <p class="text-sm font-medium">开启规则检索</p>
              <p class="text-xs text-muted-foreground">
                开启后，`/i/:slug?q=...` 会按 tags / caption / alias 等字段做规则打分。
              </p>
            </div>
            <Switch v-model="ruleSearchEnabled" :disabled="settingsLoading || settingsSaving" />
          </div>

          <div class="flex items-center justify-between rounded-md border p-3">
            <div class="space-y-1">
              <p class="text-sm font-medium">开启语义检索（暂不可用）</p>
              <p class="text-xs text-muted-foreground">
                该能力当前锁定为关闭，用于后续嵌入检索测试。
              </p>
            </div>
            <Switch
              v-model="semanticSearchEnabled"
              :disabled="semanticSearchLocked || settingsLoading || settingsSaving"
            />
          </div>

          <div class="flex items-center gap-2">
            <Button :disabled="settingsLoading || settingsSaving" @click="saveSettings">
              <Save class="mr-2 h-4 w-4" />
              {{ settingsSaving ? '保存中...' : '保存检索设置' }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.cache') }}</CardTitle>
          <CardDescription>{{ t('settings.cacheDesc') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" @click="clearCache">
            <RefreshCw class="mr-2 h-4 w-4" />
            {{ t('settings.clearCache') }}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.account') }}</CardTitle>
          <CardDescription>{{ t('settings.accountDesc') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator class="mb-4" />
          <Button variant="destructive" @click="authStore.logout">
            <LogOut class="mr-2 h-4 w-4" />
            {{ t('auth.logout') }}
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
