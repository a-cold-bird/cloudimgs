<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAlbumStore, type Album } from '@/stores/albums'
import { useUploadStore } from '@/stores/upload'
import ImageGallery from '@/components/gallery/ImageGallery.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Share2, Copy, RefreshCw, Ban, Hash } from 'lucide-vue-next'
import api from '@/services/api'
import { toast } from 'vue-sonner'

const route = useRoute()
const router = useRouter()
const store = useAlbumStore()
const uploadStore = useUploadStore()
const album = ref<Album | null>(null)
const loading = ref(true)
const isShareDialogOpen = ref(false)
const isShareLoading = ref(false)
const isShareCreating = ref(false)
const shareExpireSeconds = ref(24 * 60 * 60)
const shareBurnAfterReading = ref(false)
const latestShareUrl = ref('')
const isDedupeDialogOpen = ref(false)
const dedupeKeep = ref<'oldest' | 'newest' | 'first'>('oldest')
const dedupeDryRun = ref(true)
const dedupeLoading = ref(false)

interface DedupeResult {
  scannedFiles: number
  uniqueHashes: number
  duplicateGroups: number
  duplicateFiles: number
  removedFiles: number
  failedFiles: number
}

const dedupeResult = ref<DedupeResult | null>(null)

interface ShareItem {
  token: string
  signature: string
  createdAt: number
  expireSeconds?: number
  burnAfterReading?: boolean
  status: 'active' | 'expired' | 'revoked' | 'burned'
}

const shareItems = ref<ShareItem[]>([])

async function loadAlbum() {
  const slug = route.params.slug as string
  if (!slug) return
  
  // Try to find album by slug
  const found = await store.getAlbumBySlug(slug)
  if (found) {
    album.value = found
  } else {
    console.error('Album not found')
  }
}

async function handlePublicToggle(val: boolean) {
  if (!album.value) return
  // v-model 已经自动更新了 album.isPublic，只需要调用 API
  const success = await store.updateAlbum(album.value.id, { isPublic: val })
  if (!success) {
    // API 失败，回滚 UI 状态
    album.value.isPublic = !val
  }
}

function buildShareUrl(token: string): string {
  return `${window.location.origin}/share?token=${encodeURIComponent(token)}`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString()
}

function formatExpire(expireSeconds?: number): string {
  if (!expireSeconds || expireSeconds <= 0) {
    return '永久'
  }
  const hours = Math.floor(expireSeconds / 3600)
  if (hours >= 24 && expireSeconds % 86400 === 0) {
    return `${expireSeconds / 86400} 天`
  }
  if (hours > 0 && expireSeconds % 3600 === 0) {
    return `${hours} 小时`
  }
  return `${expireSeconds} 秒`
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('链接已复制')
  } catch {
    const input = document.createElement('input')
    input.value = text
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    toast.success('链接已复制')
  }
}

async function loadShareItems() {
  if (!album.value) return
  isShareLoading.value = true
  try {
    const res = await api.get('/share/list', {
      params: { path: album.value.id }
    })
    const data = res.data?.data || []
    shareItems.value = Array.isArray(data) ? data : []
  } catch (error) {
    console.error('Failed to load share links:', error)
    toast.error('加载分享链接失败')
  } finally {
    isShareLoading.value = false
  }
}

async function openShareDialog() {
  isShareDialogOpen.value = true
  await loadShareItems()
}

async function generateShareLink() {
  if (!album.value) return
  isShareCreating.value = true
  try {
    const expire = Number(shareExpireSeconds.value)
    const expireSeconds = Number.isFinite(expire) && expire > 0 ? expire : undefined
    const res = await api.post('/share/generate', {
      path: album.value.id,
      expireSeconds,
      burnAfterReading: shareBurnAfterReading.value
    })
    const token = res.data?.token
    if (token) {
      latestShareUrl.value = buildShareUrl(token)
      await copyText(latestShareUrl.value)
      await loadShareItems()
    } else {
      toast.error('生成分享链接失败')
    }
  } catch (error) {
    console.error('Failed to generate share link:', error)
    toast.error('生成分享链接失败')
  } finally {
    isShareCreating.value = false
  }
}

async function revokeShare(signature: string) {
  if (!album.value) return
  try {
    await api.post('/share/revoke', {
      path: album.value.id,
      signature
    })
    toast.success('链接已撤销')
    await loadShareItems()
  } catch (error) {
    console.error('Failed to revoke share link:', error)
    toast.error('撤销失败')
  }
}

async function runAlbumDedupe() {
  if (!album.value) return
  dedupeLoading.value = true
  try {
    const res = await api.post('/albums/dedupe', {
      albumId: album.value.id,
      keep: dedupeKeep.value,
      dryRun: dedupeDryRun.value
    })
    const data = res.data?.data
    dedupeResult.value = data || null

    if (dedupeDryRun.value) {
      toast.success('去重预检完成')
    } else {
      toast.success(`去重完成：删除 ${data?.removedFiles || 0} 个重复文件`)
      await loadAlbum()
    }
  } catch (error) {
    console.error('Failed to dedupe album:', error)
    toast.error('相册去重失败')
  } finally {
    dedupeLoading.value = false
  }
}

function onDedupeModeChange(event: Event) {
  const target = event.target as HTMLSelectElement | null
  dedupeDryRun.value = target?.value !== 'apply'
}

watch(() => uploadStore.isUploading, async (newVal, oldVal) => {
  if (!newVal && oldVal) {
     // Upload finished, refresh album info (file count)
     await loadAlbum()
  }
})

onMounted(async () => {
  loading.value = true
  await loadAlbum()
  loading.value = false
})

</script>

<template>
  <div class="min-h-full">
    <div v-if="loading" class="py-10 text-center">
        Loading...
    </div>

    <ImageGallery v-else-if="album" :album-id="album.id" :show-title="false">
        <template #header-start>
            <div class="flex items-center gap-4">
                <Button variant="ghost" size="icon" @click="router.back()">
                    <ArrowLeft class="h-4 w-4" />
                </Button>
                <div>
                    <h2 class="text-2xl font-bold tracking-tight">{{ album.name }}</h2>
                    <p class="text-muted-foreground text-sm">
                        {{ album.isPublic ? '公开' : '私有' }} · {{ album.fileCount || 0 }} items
                    </p>
                </div>
            </div>
        </template>

        <template #header-actions>
            <div class="flex items-center space-x-2 mr-2">
                <Button variant="outline" size="sm" @click="isDedupeDialogOpen = true">
                    <Hash class="h-4 w-4 mr-2" />
                    去重
                </Button>
                <Button variant="outline" size="sm" @click="openShareDialog">
                    <Share2 class="h-4 w-4 mr-2" />
                    分享
                </Button>
                <div class="flex items-center space-x-2 border-l pl-4">
                    <Switch v-model="album.isPublic" @update:model-value="handlePublicToggle" id="public-mode" />
                    <label for="public-mode" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer hidden sm:inline-block">
                        {{ album.isPublic ? '公开' : '私有' }}
                    </label>
                </div>
            </div>
        </template>
    </ImageGallery>

    <div v-else class="py-10 text-center text-muted-foreground">
        Album not found.
    </div>

    <Dialog :open="isShareDialogOpen" @update:open="isShareDialogOpen = $event">
        <DialogContent class="max-w-2xl">
            <DialogHeader>
                <DialogTitle>分享链接管理</DialogTitle>
                <DialogDescription>
                    为当前相册创建可访问链接，可设置过期时间与阅后即焚。
                </DialogDescription>
            </DialogHeader>

            <div class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div class="space-y-1 md:col-span-2">
                        <label class="text-sm text-muted-foreground">过期时间（秒，留空/0 为永久）</label>
                        <Input
                            type="number"
                            min="0"
                            v-model.number="shareExpireSeconds"
                            placeholder="例如 86400（1 天）"
                        />
                    </div>
                    <div class="space-y-1">
                        <label class="text-sm text-muted-foreground">阅后即焚</label>
                        <div class="h-10 flex items-center border rounded-md px-3">
                            <Switch v-model="shareBurnAfterReading" />
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <Button :disabled="isShareCreating" @click="generateShareLink">
                        <Share2 class="h-4 w-4 mr-2" />
                        {{ isShareCreating ? '生成中...' : '生成并复制链接' }}
                    </Button>
                    <Button variant="outline" :disabled="isShareLoading" @click="loadShareItems">
                        <RefreshCw class="h-4 w-4 mr-2" />
                        刷新
                    </Button>
                </div>

                <div v-if="latestShareUrl" class="rounded-md border bg-muted/30 p-3 text-sm">
                    <div class="text-muted-foreground mb-1">最近生成</div>
                    <div class="flex items-center gap-2">
                        <code class="flex-1 truncate">{{ latestShareUrl }}</code>
                        <Button variant="outline" size="icon" @click="copyText(latestShareUrl)">
                            <Copy class="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                <div class="space-y-2 max-h-[360px] overflow-auto">
                    <div v-if="isShareLoading" class="text-sm text-muted-foreground py-6 text-center">
                        加载中...
                    </div>
                    <div v-else-if="shareItems.length === 0" class="text-sm text-muted-foreground py-6 text-center">
                        暂无分享链接
                    </div>
                    <div v-else v-for="item in shareItems" :key="item.signature" class="rounded-md border p-3 space-y-2">
                        <div class="flex items-center justify-between gap-3">
                            <div class="text-sm">
                                <span class="font-medium">状态：</span>
                                <span>{{ item.status }}</span>
                                <span class="mx-2 text-muted-foreground">|</span>
                                <span class="font-medium">创建：</span>
                                <span>{{ formatDate(item.createdAt) }}</span>
                                <span class="mx-2 text-muted-foreground">|</span>
                                <span class="font-medium">过期：</span>
                                <span>{{ formatExpire(item.expireSeconds) }}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <Button variant="outline" size="icon" @click="copyText(buildShareUrl(item.token))">
                                    <Copy class="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    :disabled="item.status !== 'active'"
                                    @click="revokeShare(item.signature)"
                                >
                                    <Ban class="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>

    <Dialog :open="isDedupeDialogOpen" @update:open="isDedupeDialogOpen = $event">
      <DialogContent class="max-w-xl">
        <DialogHeader>
          <DialogTitle>相册去重（SHA-256）</DialogTitle>
          <DialogDescription>
            仅处理当前相册，不递归子相册。可先预检，再执行删除重复文件。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-sm text-muted-foreground">保留策略</label>
              <select
                v-model="dedupeKeep"
                class="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="oldest">保留最早上传</option>
                <option value="newest">保留最新上传</option>
                <option value="first">按文件名排序保留首个</option>
              </select>
            </div>
            <div class="space-y-1">
              <label class="text-sm text-muted-foreground">执行模式</label>
              <select
                :value="dedupeDryRun ? 'dry' : 'apply'"
                @change="onDedupeModeChange"
                class="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="dry">预检（不删除）</option>
                <option value="apply">执行（删除重复）</option>
              </select>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button :disabled="dedupeLoading" @click="runAlbumDedupe">
              <Hash class="h-4 w-4 mr-2" />
              {{ dedupeLoading ? '处理中...' : (dedupeDryRun ? '开始预检' : '开始去重') }}
            </Button>
          </div>

          <div v-if="dedupeResult" class="rounded-md border p-3 text-sm space-y-1">
            <div>扫描文件：{{ dedupeResult.scannedFiles }}</div>
            <div>唯一哈希：{{ dedupeResult.uniqueHashes }}</div>
            <div>重复分组：{{ dedupeResult.duplicateGroups }}</div>
            <div>重复文件：{{ dedupeResult.duplicateFiles }}</div>
            <div>已删除：{{ dedupeResult.removedFiles }}</div>
            <div>失败：{{ dedupeResult.failedFiles }}</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

