<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, Check, Lock, ExternalLink, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface ApiEndpoint {
  name: string
  endpoint: string
  usage: {
    random: string
    list: string
    specific: string
  }
}

interface EndpointExample {
  key: string
  label: string
  path: string
  description: string
  canOpen?: boolean
}

const router = useRouter()
const endpoints = ref<ApiEndpoint[]>([])
const isLoading = ref(true)
const baseUrl = ref('')
const copiedUrl = ref<string | null>(null)

const QUERY_SAMPLE = '伤心'

function normalizeBaseUrl(serverBaseUrl?: string): string {
  const origin = window.location.origin
  const raw = String(serverBaseUrl || '').trim()
  if (!raw) return origin

  try {
    const serverUrl = new URL(raw)
    const pageUrl = new URL(origin)
    const isLocalHost = serverUrl.hostname === 'localhost' || serverUrl.hostname === '127.0.0.1'

    // 如果后端返回 localhost 但当前页面是公网地址，则以当前访问域名为准
    if (isLocalHost && pageUrl.hostname !== 'localhost' && pageUrl.hostname !== '127.0.0.1') {
      return origin
    }

    return `${serverUrl.protocol}//${serverUrl.host}`
  } catch {
    return origin
  }
}

function getFullUrl(path: string): string {
  const base = baseUrl.value.replace(/\/+$/, '')
  const route = path.startsWith('/') ? path : `/${path}`
  return `${base}${route}`
}

function buildExamples(ep: ApiEndpoint): EndpointExample[] {
  const q = QUERY_SAMPLE

  return [
    {
      key: 'random',
      label: '随机取图（推荐）',
      path: ep.endpoint,
      description: '直接返回图片（302 重定向到真实文件 URL）',
    },
    {
      key: 'query-random',
      label: '按语义取图（推荐）',
      path: `${ep.endpoint}?q=${q}`,
      description: '按标注检索目标图，命中不足自动回退随机图',
    },
    {
      key: 'specific',
      label: '指定文件取图（模板）',
      path: `${ep.endpoint}/{filename}`,
      description: '将 {filename} 替换为真实文件名后使用',
      canOpen: false,
    },
  ]
}

function buildJsonExamples(ep: ApiEndpoint): EndpointExample[] {
  const q = QUERY_SAMPLE
  return [
    {
      key: 'json-list',
      label: '列表 JSON',
      path: `${ep.endpoint}?json=true&page=1&limit=20`,
      description: '返回相册图片列表与分页信息',
    },
    {
      key: 'json-query-random',
      label: '检索单图 JSON',
      path: `${ep.endpoint}?json=true&random=true&q=${q}`,
      description: '返回单图对象（含 fallbackRandom/score）',
    },
  ]
}

async function fetchEndpoints() {
  isLoading.value = true
  try {
    const response = await api.get('/i', { baseURL: '' })
    if (response.data.success) {
      baseUrl.value = normalizeBaseUrl(response.data.baseUrl)
      endpoints.value = response.data.endpoints || []
      return
    }

    baseUrl.value = window.location.origin
    endpoints.value = []
  } catch (error) {
    console.error('Failed to fetch endpoints:', error)
    baseUrl.value = window.location.origin
    endpoints.value = []
    toast.error('加载 API 示例失败，请检查后端 /i 接口')
  } finally {
    isLoading.value = false
  }
}

function copyUrl(url: string) {
  navigator.clipboard.writeText(url)
  copiedUrl.value = url
  toast.success('已复制')
  setTimeout(() => {
    copiedUrl.value = null
  }, 2000)
}

function goToAdmin() {
  router.push('/admin')
}

onMounted(() => {
  fetchEndpoints()
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="border-b">
      <div class="container mx-auto px-4 py-4 flex items-center justify-between">
        <div>
          <h1 class="text-xl font-bold">CloudImgs</h1>
          <p class="text-xs text-muted-foreground">Image API Service</p>
        </div>
        <Button @click="goToAdmin" size="sm">
          <Lock class="w-4 h-4 mr-2" />
          管理后台
        </Button>
      </div>
    </header>

    <main class="container mx-auto px-4 py-8">
      <div class="mb-8 space-y-2">
        <h2 class="text-2xl font-bold">API 使用示例</h2>
        <p class="text-muted-foreground">
          当前 API Base URL:
          <code class="bg-muted px-2 py-1 rounded text-sm">{{ baseUrl }}</code>
        </p>
        <p class="text-xs text-muted-foreground">
          示例查询词：<code class="bg-muted px-1 rounded">{{ QUERY_SAMPLE }}</code>
        </p>
      </div>

      <div v-if="isLoading" class="flex items-center justify-center py-12">
        <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="endpoints.length === 0" class="text-center py-12 text-muted-foreground">
        暂无公开的 API 端点
      </div>

      <div v-else class="space-y-4">
        <Card v-for="ep in endpoints" :key="ep.endpoint">
          <CardHeader class="pb-3">
            <CardTitle class="text-base font-medium">{{ ep.name }}</CardTitle>
          </CardHeader>

          <CardContent class="space-y-3">
            <div
              v-for="example in buildExamples(ep)"
              :key="`${ep.endpoint}-${example.key}`"
              class="space-y-1"
            >
              <div class="text-xs text-muted-foreground">{{ example.label }} · {{ example.description }}</div>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-sm bg-muted px-3 py-2 rounded overflow-x-auto">
                  GET {{ example.path }}
                </code>
                <Button
                  size="icon"
                  variant="outline"
                  @click="copyUrl(getFullUrl(example.path))"
                >
                  <Check v-if="copiedUrl === getFullUrl(example.path)" class="w-4 h-4 text-green-500" />
                  <Copy v-else class="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  :disabled="example.canOpen === false"
                  as="a"
                  :href="example.canOpen === false ? undefined : getFullUrl(example.path)"
                  target="_blank"
                >
                  <ExternalLink class="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="mt-8 pt-8 border-t text-sm text-muted-foreground space-y-2">
        <p><strong>说明：</strong></p>
        <ul class="list-disc list-inside space-y-1 ml-2">
          <li>主流程建议直接使用取图接口：<code class="bg-muted px-1 rounded">GET /i/{'{slug}'}</code> 或 <code class="bg-muted px-1 rounded">GET /i/{'{slug}'}?q=...</code>。</li>
          <li>如果用于程序调度和调试，再使用 JSON 模式（见下方折叠区域）。</li>
        </ul>
      </div>

      <details class="mt-4 rounded-md border p-3 text-sm">
        <summary class="cursor-pointer font-medium">查看 JSON 调用示例（可选）</summary>
        <div class="mt-3 space-y-4">
          <Card v-for="ep in endpoints" :key="`json-${ep.endpoint}`">
            <CardHeader class="pb-3">
              <CardTitle class="text-sm font-medium">{{ ep.name }} · JSON</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3">
              <div
                v-for="example in buildJsonExamples(ep)"
                :key="`${ep.endpoint}-${example.key}`"
                class="space-y-1"
              >
                <div class="text-xs text-muted-foreground">{{ example.label }} · {{ example.description }}</div>
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded overflow-x-auto">
                    GET {{ example.path }}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    @click="copyUrl(getFullUrl(example.path))"
                  >
                    <Check v-if="copiedUrl === getFullUrl(example.path)" class="w-4 h-4 text-green-500" />
                    <Copy v-else class="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="outline"
                    as="a"
                    :href="getFullUrl(example.path)"
                    target="_blank"
                  >
                    <ExternalLink class="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </details>
    </main>
  </div>
</template>
