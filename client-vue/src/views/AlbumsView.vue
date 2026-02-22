<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAlbumStore, type Album } from '@/stores/albums'
import { useUploadStore } from '@/stores/upload'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Folder, Plus, Trash2, FolderOpen, Wand2, Play, Square } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const router = useRouter()
const store = useAlbumStore()
const uploadStore = useUploadStore()

const newAlbumName = ref('')
const isDialogOpen = ref(false)

const isDeleteConfirmOpen = ref(false)
const albumToDelete = ref<Album | null>(null)

const isAnnotateDialogOpen = ref(false)
const albumToAnnotate = ref<Album | null>(null)
const annotateSkipExisting = ref(true)
const annotateConcurrency = ref(2)
const annotateHints = ref('')
const annotateRunning = ref(false)
const annotateTotal = ref(0)
const annotateProcessed = ref(0)
const annotateSuccess = ref(0)
const annotateFailed = ref(0)
const annotateDoneReceived = ref(false)
const annotateEventSource = ref<EventSource | null>(null)
const annotateStoppedByUser = ref(false)

interface AnnotateLog {
  id: number
  timestamp: number
  status: 'start' | 'success' | 'failed' | 'done' | 'info'
  filename?: string
  message: string
  durationMs?: number
}

const annotateLogs = ref<AnnotateLog[]>([])
const annotateLogContainer = ref<HTMLElement | null>(null)
let annotateLogSeed = 0

const annotateProgress = computed(() => {
  if (annotateTotal.value <= 0) return 0
  return Math.min(100, Math.round((annotateProcessed.value / annotateTotal.value) * 100))
})

function encodeAlbumIdForApi(id: string): string {
  return id
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/')
}

function navigateToAlbum(album: Album) {
  router.push(`/admin/albums/${encodeURIComponent(album.id)}`)
}

function appendAnnotateLog(log: Omit<AnnotateLog, 'id' | 'timestamp'> & { timestamp?: number }) {
  const timestamp = Number(log.timestamp || Date.now())
  annotateLogs.value.push({
    id: Date.now() + (annotateLogSeed++),
    timestamp,
    ...log,
  })
  if (annotateLogs.value.length > 300) {
    annotateLogs.value.splice(0, annotateLogs.value.length - 300)
  }
  void nextTick(() => {
    if (annotateLogContainer.value) {
      annotateLogContainer.value.scrollTop = annotateLogContainer.value.scrollHeight
    }
  })
}

function formatLogTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
}

function resetAnnotateState() {
  annotateTotal.value = 0
  annotateProcessed.value = 0
  annotateSuccess.value = 0
  annotateFailed.value = 0
  annotateDoneReceived.value = false
  annotateLogs.value = []
}

function getLogClass(status: AnnotateLog['status']) {
  if (status === 'success') return 'text-emerald-600'
  if (status === 'failed') return 'text-destructive'
  if (status === 'done') return 'text-primary'
  return 'text-muted-foreground'
}

function openDeleteConfirm(album: Album) {
  albumToDelete.value = album
  isDeleteConfirmOpen.value = true
}

async function confirmDelete() {
  if (!albumToDelete.value) return
  await store.deleteAlbum(albumToDelete.value.id)
  isDeleteConfirmOpen.value = false
  albumToDelete.value = null
}

async function handleCreate() {
  if (!newAlbumName.value) return
  const success = await store.createAlbum(newAlbumName.value)
  if (success) {
    isDialogOpen.value = false
    newAlbumName.value = ''
  }
}

async function loadAnnotationDefaults() {
  try {
    const res = await api.get('/settings')
    const value = Number(res.data?.data?.annotation?.concurrency)
    if (Number.isFinite(value)) {
      annotateConcurrency.value = Math.min(10, Math.max(1, Math.round(value)))
    }
  } catch {
    // keep local default
  }
}

function openAnnotateDialog(album: Album) {
  albumToAnnotate.value = album
  annotateSkipExisting.value = true
  annotateHints.value = ''
  resetAnnotateState()
  isAnnotateDialogOpen.value = true
  void loadAnnotationDefaults()
}

function stopAnnotation() {
  if (!annotateEventSource.value) return
  annotateStoppedByUser.value = true
  annotateEventSource.value.close()
  annotateEventSource.value = null
  appendAnnotateLog({
    status: 'info',
    message: '已手动停止标注任务。',
  })
  toast.info('已停止标注任务')
}

function applyAnnotateEvent(event: string, payload: any) {
  if (event === 'start') {
    annotateTotal.value = Number(payload?.total || 0)
    annotateProcessed.value = 0
    annotateSuccess.value = 0
    annotateFailed.value = 0
    const hints = Array.isArray(payload?.hintKeywords) ? payload.hintKeywords : []
    appendAnnotateLog({
      status: 'start',
      timestamp: Number(payload?.timestamp || Date.now()),
      message: `开始标注：${payload?.albumName || ''}，扫描 ${payload?.scanned ?? payload?.total ?? 0}，待处理 ${payload?.total || 0}，跳过 ${payload?.skipped || 0}，模式 ${payload?.skipExisting === false ? '覆盖已有' : '跳过已有'}，并发 ${payload?.concurrency || annotateConcurrency.value}${hints.length ? `，注入关键词 ${hints.join(' / ')}` : ''}`,
    })
    return
  }

  if (event === 'progress') {
    appendAnnotateLog({
      status: 'info',
      timestamp: Number(payload?.timestamp || Date.now()),
      filename: payload?.filename,
      message: `处理中：${payload?.filename || 'unknown'} (${Number(payload?.processed || 0) + 1}/${payload?.total || '?'})`,
    })
    return
  }

  if (event === 'heartbeat') {
    annotateProcessed.value = Number(payload?.processed || annotateProcessed.value)
    annotateSuccess.value = Number(payload?.success || annotateSuccess.value)
    annotateFailed.value = Number(payload?.failed || annotateFailed.value)
    annotateTotal.value = Number(payload?.total || annotateTotal.value)
    return
  }

  if (event === 'item') {
    const status = payload?.status === 'success' ? 'success' : 'failed'
    if (status === 'success') {
      annotateSuccess.value += 1
    } else {
      annotateFailed.value += 1
    }

    annotateProcessed.value = Number(payload?.processed || (annotateProcessed.value + 1))
    annotateTotal.value = Number(payload?.total || annotateTotal.value)

    appendAnnotateLog({
      status,
      timestamp: Number(payload?.timestamp || Date.now()),
      filename: payload?.filename,
      durationMs: Number(payload?.durationMs || 0),
      message: status === 'success'
        ? `${payload?.filename || 'unknown'} 标注成功`
        : `${payload?.filename || 'unknown'} 标注失败：${payload?.error || 'unknown error'}`,
    })
    return
  }

  if (event === 'done') {
    annotateDoneReceived.value = true
    annotateTotal.value = Number(payload?.total || annotateTotal.value)
    annotateProcessed.value = Number(payload?.processed || annotateProcessed.value)
    annotateSuccess.value = Number(payload?.success || annotateSuccess.value)
    annotateFailed.value = Number(payload?.failed || annotateFailed.value)
    const skipped = Number(payload?.skipped || 0)

    appendAnnotateLog({
      status: 'done',
      timestamp: Number(payload?.timestamp || Date.now()),
      message: `标注完成：成功 ${annotateSuccess.value}，失败 ${annotateFailed.value}，跳过 ${skipped}`,
    })

    if (annotateFailed.value > 0) {
      toast.warning(`标注完成，失败 ${annotateFailed.value} 张`)
    } else if (annotateSuccess.value === 0 && skipped > 0) {
      toast.info(`无可标注图片，已跳过 ${skipped} 张`)
    } else {
      toast.success(`标注完成，成功 ${annotateSuccess.value} 张`)
    }
  }
}

async function runAnnotate() {
  if (!albumToAnnotate.value || annotateRunning.value) return

  resetAnnotateState()
  annotateRunning.value = true
  annotateStoppedByUser.value = false

  const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token')
  const concurrency = Math.min(10, Math.max(1, Math.round(Number(annotateConcurrency.value) || 2)))
  annotateConcurrency.value = concurrency

  const params = new URLSearchParams({
    skipExisting: annotateSkipExisting.value ? 'true' : 'false',
    concurrency: String(concurrency),
  })
  const hints = annotateHints.value.trim()
  if (hints) {
    params.set('hints', hints)
  }
  if (token) {
    params.set('password', token)
  }

  const url = `/api/albums/${encodeAlbumIdForApi(albumToAnnotate.value.id)}/annotate/stream?${params.toString()}`

  try {
    await new Promise<void>((resolve, reject) => {
      const es = new EventSource(url)
      annotateEventSource.value = es

      const safeParse = (text: string) => {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }

      const bind = (eventName: string) => {
        es.addEventListener(eventName, (evt: MessageEvent) => {
          applyAnnotateEvent(eventName, safeParse(evt.data))
          if (eventName === 'done') {
            es.close()
            annotateEventSource.value = null
            resolve()
          }
        })
      }

      bind('start')
      bind('progress')
      bind('item')
      bind('heartbeat')
      bind('done')

      es.onerror = () => {
        es.close()
        annotateEventSource.value = null
        if (annotateStoppedByUser.value || annotateDoneReceived.value) {
          resolve()
          return
        }
        reject(new Error('标注流连接中断，请重试'))
      }
    })

    if (!annotateDoneReceived.value) {
      appendAnnotateLog({
        status: 'info',
        message: '流结束，但未收到 done 事件。',
      })
    }

    await store.fetchAlbums()
  } catch (error: any) {
    if (!annotateStoppedByUser.value) {
      console.error('Annotation stream failed:', error)
      appendAnnotateLog({
        status: 'failed',
        message: `任务失败：${error?.message || 'unknown error'}`,
      })
      toast.error(`标注任务失败：${error?.message || 'unknown error'}`)
    }
  } finally {
    annotateEventSource.value = null
    annotateRunning.value = false
  }
}

watch(
  () => uploadStore.isUploading,
  (newVal, oldVal) => {
    if (!newVal && oldVal) {
      void store.fetchAlbums()
    }
  },
)

watch(
  () => isAnnotateDialogOpen.value,
  (open) => {
    if (!open && annotateRunning.value) {
      stopAnnotation()
    }
  },
)

onMounted(() => {
  void store.fetchAlbums()
})

onBeforeUnmount(() => {
  if (annotateRunning.value) {
    stopAnnotation()
  }
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold tracking-tight">{{ t('albums.title') }}</h2>
        <p class="text-muted-foreground">{{ t('albums.description') }}</p>
      </div>

      <Dialog v-model:open="isDialogOpen">
        <DialogTrigger as-child>
          <Button class="gap-2">
            <Plus class="h-4 w-4" />
            {{ t('albums.newAlbum') }}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{{ t('albums.newAlbum') }}</DialogTitle>
          </DialogHeader>
          <div class="py-4">
            <Input v-model="newAlbumName" :placeholder="t('albums.albumNamePlaceholder')" @keyup.enter="handleCreate" />
          </div>
          <DialogFooter>
            <Button @click="handleCreate">{{ t('albums.create') }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <div v-if="store.isLoading" class="py-10 text-center text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="store.albums.length === 0" class="rounded-lg border-2 border-dashed py-20 text-center text-muted-foreground">
      <FolderOpen class="mx-auto mb-4 h-12 w-12 opacity-50" />
      <p>{{ t('albums.noAlbums') }}</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <Card
        v-for="album in store.albums"
        :key="album.id"
        class="group relative cursor-pointer transition-shadow hover:shadow-md"
        @click="navigateToAlbum(album)"
      >
        <CardHeader class="p-4 pb-2">
          <div class="flex items-start justify-between">
            <Folder class="h-8 w-8 fill-blue-500/20 text-blue-500" />
            <div class="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                class="relative -mr-1 -mt-2 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                title="标注相册"
                @click.stop="openAnnotateDialog(album)"
              >
                <Wand2 class="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="relative -mr-2 -mt-2 h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                @click.stop="openDeleteConfirm(album)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent class="p-4 pt-2">
          <div class="block">
            <h3 class="truncate font-medium">{{ album.name }}</h3>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('albums.items', { count: album.fileCount || 0 }) }}</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <Dialog v-model:open="isDeleteConfirmOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ t('albums.deleteConfirm') }}</DialogTitle>
          <DialogDescription>
            {{ t('albums.deleteWarning', { name: albumToDelete?.name }) }}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="isDeleteConfirmOpen = false">{{ t('common.cancel') }}</Button>
          <Button variant="destructive" @click="confirmDelete">{{ t('common.confirm') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="isAnnotateDialogOpen">
      <DialogContent class="max-w-3xl">
        <DialogHeader>
          <DialogTitle>相册标注</DialogTitle>
          <DialogDescription>
            对相册内图片调用标注接口，实时显示进度与结果。可配置并发与覆盖策略。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="rounded-md border p-3 text-sm">
            <div><span class="text-muted-foreground">相册：</span>{{ albumToAnnotate?.name || '-' }}</div>
            <div><span class="text-muted-foreground">ID：</span>{{ albumToAnnotate?.id || '-' }}</div>
          </div>

          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div class="space-y-1">
              <label class="text-sm text-muted-foreground">并发数 (1-10)</label>
              <Input
                v-model.number="annotateConcurrency"
                type="number"
                min="1"
                max="10"
                :disabled="annotateRunning"
              />
            </div>

            <div class="space-y-1">
              <label class="text-sm text-muted-foreground">跳过已有标注（仅本次）</label>
              <div class="flex h-10 items-center rounded-md border px-3">
                <Switch v-model="annotateSkipExisting" :disabled="annotateRunning" />
                <span class="ml-2 text-sm text-muted-foreground">{{ annotateSkipExisting ? '是' : '否' }}</span>
              </div>
            </div>

            <div class="space-y-1 md:col-span-2">
              <label class="text-sm text-muted-foreground">手动注入关键词（可选）</label>
              <textarea
                v-model="annotateHints"
                class="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="例如：幸福, 摸头, 可爱, 安慰, 治愈（支持逗号/空格/换行分隔）"
                :disabled="annotateRunning"
              />
              <p class="text-xs text-muted-foreground">仅影响本次标注任务，不会改写全局设置。</p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Button :disabled="annotateRunning || !albumToAnnotate" @click="runAnnotate">
              <Play class="mr-2 h-4 w-4" />
              开始标注
            </Button>
            <Button variant="outline" :disabled="!annotateRunning" @click="stopAnnotation">
              <Square class="mr-2 h-4 w-4" />
              停止
            </Button>
          </div>

          <div class="space-y-2 rounded-md border p-3">
            <div class="flex items-center justify-between text-sm">
              <span>进度 {{ annotateProcessed }} / {{ annotateTotal }}</span>
              <span>{{ annotateProgress }}%</span>
            </div>
            <Progress :model-value="annotateProgress" class="h-2" />
            <div class="flex gap-4 text-xs text-muted-foreground">
              <span>成功：{{ annotateSuccess }}</span>
              <span>失败：{{ annotateFailed }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="text-sm font-medium">实时日志</div>
            <div ref="annotateLogContainer" class="max-h-[260px] space-y-1 overflow-auto rounded-md border p-2 text-sm">
              <div v-if="annotateLogs.length === 0" class="py-4 text-center text-muted-foreground">
                暂无日志
              </div>
              <div v-for="log in annotateLogs" :key="log.id" class="rounded px-2 py-1" :class="getLogClass(log.status)">
                <span class="font-mono text-xs">[{{ formatLogTime(log.timestamp) }}]</span>
                <span class="ml-1 font-mono text-xs">[{{ log.status }}]</span>
                <span class="ml-2">{{ log.message }}</span>
                <span v-if="log.durationMs" class="ml-2 text-xs text-muted-foreground">{{ log.durationMs }}ms</span>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
