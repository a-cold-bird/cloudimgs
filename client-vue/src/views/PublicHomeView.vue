<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { 
  Copy, 
  Check,
  Lock,
  ExternalLink,
  Loader2
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface ApiEndpoint {
  name: string
  endpoint: string
  slug: string
  usage: {
    random: string
    list: string
    specific: string
  }
}

const router = useRouter()
const endpoints = ref<ApiEndpoint[]>([])
const isLoading = ref(true)
const baseUrl = ref('')
const copiedUrl = ref<string | null>(null)

async function fetchEndpoints() {
  isLoading.value = true
  try {
    const response = await api.get('/i', { baseURL: '' })
    if (response.data.success) {
      baseUrl.value = response.data.baseUrl
      endpoints.value = response.data.endpoints.map((ep: any) => ({
        ...ep,
        slug: ep.endpoint.replace('/i/', ''),
      }))
    }
  } catch (error) {
    console.error('Failed to fetch endpoints:', error)
  } finally {
    isLoading.value = false
  }
}

function getFullUrl(path: string): string {
  return `${baseUrl.value}${path}`
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
    <!-- Header -->
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

    <!-- Main Content -->
    <main class="container mx-auto px-4 py-8">
      <!-- Title -->
      <div class="mb-8">
        <h2 class="text-2xl font-bold mb-2">API 端点</h2>
        <p class="text-muted-foreground">
          Base URL: <code class="bg-muted px-2 py-1 rounded text-sm">{{ baseUrl }}</code>
        </p>
      </div>

      <!-- Loading -->
      <div v-if="isLoading" class="flex items-center justify-center py-12">
        <Loader2 class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>

      <!-- Empty -->
      <div v-else-if="endpoints.length === 0" class="text-center py-12 text-muted-foreground">
        暂无公开的 API 端点
      </div>

      <!-- Endpoints List -->
      <div v-else class="space-y-4">
        <Card v-for="ep in endpoints" :key="ep.endpoint">
          <CardHeader class="pb-3">
            <CardTitle class="text-base font-medium">{{ ep.name }}</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <!-- Random Image -->
            <div class="flex items-center gap-2">
              <code class="flex-1 text-sm bg-muted px-3 py-2 rounded overflow-x-auto">
                GET {{ ep.endpoint }}
              </code>
              <Button 
                size="icon" 
                variant="outline"
                @click="copyUrl(getFullUrl(ep.endpoint))"
              >
                <Check v-if="copiedUrl === getFullUrl(ep.endpoint)" class="w-4 h-4 text-green-500" />
                <Copy v-else class="w-4 h-4" />
              </Button>
              <Button 
                size="icon" 
                variant="outline"
                as="a"
                :href="ep.endpoint"
                target="_blank"
              >
                <ExternalLink class="w-4 h-4" />
              </Button>
            </div>

            <!-- List -->
            <div class="flex items-center gap-2">
              <code class="flex-1 text-sm bg-muted px-3 py-2 rounded overflow-x-auto">
                GET {{ ep.endpoint }}?json=true
              </code>
              <Button 
                size="icon" 
                variant="outline"
                @click="copyUrl(getFullUrl(ep.endpoint + '?json=true'))"
              >
                <Check v-if="copiedUrl === getFullUrl(ep.endpoint + '?json=true')" class="w-4 h-4 text-green-500" />
                <Copy v-else class="w-4 h-4" />
              </Button>
              <Button 
                size="icon" 
                variant="outline"
                as="a"
                :href="ep.endpoint + '?json=true'"
                target="_blank"
              >
                <ExternalLink class="w-4 h-4" />
              </Button>
            </div>

            <!-- Specific -->
            <div class="flex items-center gap-2">
              <code class="flex-1 text-sm bg-muted px-3 py-2 rounded overflow-x-auto text-muted-foreground">
                GET {{ ep.endpoint }}/{'{filename}'}
              </code>
              <Button 
                size="icon" 
                variant="outline"
                @click="copyUrl(getFullUrl(ep.endpoint + '/'))"
              >
                <Copy class="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- Usage Notes -->
      <div class="mt-8 pt-8 border-t text-sm text-muted-foreground space-y-2">
        <p><strong>说明：</strong></p>
        <ul class="list-disc list-inside space-y-1 ml-2">
          <li><code class="bg-muted px-1 rounded">GET /i/{'{slug}'}</code> - 随机返回一张图片（302 重定向）</li>
          <li><code class="bg-muted px-1 rounded">GET /i/{'{slug}'}?json=true</code> - 返回图片列表（JSON）</li>
          <li><code class="bg-muted px-1 rounded">GET /i/{'{slug}'}/{'{filename}'}</code> - 返回指定图片</li>
        </ul>
      </div>
    </main>
  </div>
</template>
