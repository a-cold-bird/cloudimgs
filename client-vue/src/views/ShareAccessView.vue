<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, ArrowLeft, ExternalLink } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

interface ShareImage {
  filename: string
  url: string
  relPath: string
  uploadTime: string
  size: number
  thumbhash?: string | null
}

interface SharePagination {
  current: number
  pageSize: number
  total: number
  totalPages: number
}

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const error = ref('')
const dirName = ref('')
const images = ref<ShareImage[]>([])
const pagination = ref<SharePagination>({
  current: 1,
  pageSize: 20,
  total: 0,
  totalPages: 1
})

const token = computed(() => {
  const raw = route.query.token
  return typeof raw === 'string' ? raw : ''
})

async function fetchShareData(page = 1) {
  if (!token.value) {
    error.value = '缺少分享令牌'
    images.value = []
    return
  }

  loading.value = true
  error.value = ''
  try {
    const res = await api.get('/share/access', {
      params: {
        token: token.value,
        page,
        pageSize: pagination.value.pageSize
      }
    })

    const data = res.data?.data || []
    images.value = Array.isArray(data) ? data : []
    dirName.value = res.data?.dirName || '分享相册'
    pagination.value = res.data?.pagination || pagination.value
  } catch (err: any) {
    const message = err?.response?.data?.error || '分享链接无效或已过期'
    error.value = message
    images.value = []
    toast.error(message)
  } finally {
    loading.value = false
  }
}

function prevPage() {
  if (pagination.value.current <= 1) return
  fetchShareData(pagination.value.current - 1)
}

function nextPage() {
  if (pagination.value.current >= pagination.value.totalPages) return
  fetchShareData(pagination.value.current + 1)
}

watch(() => route.query.token, () => {
  fetchShareData(1)
})

onMounted(() => {
  fetchShareData(1)
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <header class="border-b">
      <div class="container mx-auto px-4 py-4 flex items-center gap-3">
        <Button variant="ghost" size="icon" @click="router.push('/')">
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <div>
          <h1 class="text-lg font-semibold">{{ dirName || '分享相册' }}</h1>
          <p class="text-xs text-muted-foreground">通过分享链接访问</p>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-6">
      <Card v-if="error">
        <CardHeader>
          <CardTitle>访问失败</CardTitle>
          <CardDescription>{{ error }}</CardDescription>
        </CardHeader>
      </Card>

      <div v-else-if="loading" class="py-12 flex items-center justify-center">
        <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      </div>

      <Card v-else-if="images.length === 0">
        <CardHeader>
          <CardTitle>暂无可访问内容</CardTitle>
          <CardDescription>该分享目前没有可展示图片</CardDescription>
        </CardHeader>
      </Card>

      <div v-else class="space-y-4">
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Card v-for="img in images" :key="img.relPath" class="overflow-hidden">
            <CardContent class="p-0">
              <a :href="img.url" target="_blank" class="block">
                <img :src="img.url" :alt="img.filename" class="w-full aspect-square object-cover" loading="lazy" />
              </a>
              <div class="p-3 space-y-1">
                <p class="text-sm font-medium truncate">{{ img.filename }}</p>
                <p class="text-xs text-muted-foreground">{{ new Date(img.uploadTime).toLocaleString() }}</p>
                <div class="flex justify-end">
                  <Button variant="ghost" size="sm" as="a" :href="img.url" target="_blank">
                    <ExternalLink class="h-4 w-4 mr-1" />
                    打开
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div class="flex items-center justify-center gap-3">
          <Button variant="outline" :disabled="pagination.current <= 1" @click="prevPage">上一页</Button>
          <span class="text-sm text-muted-foreground">
            第 {{ pagination.current }} / {{ pagination.totalPages }} 页（共 {{ pagination.total }} 张）
          </span>
          <Button variant="outline" :disabled="pagination.current >= pagination.totalPages" @click="nextPage">下一页</Button>
        </div>
      </div>
    </main>
  </div>
</template>
