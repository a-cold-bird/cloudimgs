<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type ImageItem } from '@/stores/gallery' // Fixed import path
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Download, Info, Tag, Trash2, Plus, ChevronLeft, ChevronRight, Pencil, Check, Link2, Wand2 } from 'lucide-vue-next'
import api from '@/services/api'
import { toast } from 'vue-sonner'

const props = defineProps<{
  image: ImageItem | null
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'deleted', id: string): void
  (e: 'renamed', id: string, newName: string, newId: string): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

const showInfo = ref(true)
const newTag = ref('')
const isDeleting = ref(false)
const confirmDelete = ref(false)

// 编辑文件名相关状态
const isEditingName = ref(false)
const editingName = ref('')
const isRenaming = ref(false)
const annotateHint = ref('')
const annotateLogs = ref<string[]>([])
const isAnnotating = ref(false)

// Reset confirm state when image changes or modal closes
watch(() => props.image, () => {
    confirmDelete.value = false
    isEditingName.value = false
})
watch(() => props.open, (val) => {
    if (!val) {
        confirmDelete.value = false
        isEditingName.value = false
    }
})

async function handleAddTag() {
    if (!props.image || !newTag.value.trim()) return
    const tag = newTag.value.trim()

    // 确保 tags 数组存在
    if (!props.image.tags) {
        props.image.tags = []
    }

    // Optimistic update check
    if (props.image.tags.includes(tag)) {
        newTag.value = ''
        return
    }

    try {
        await api.post(`/tags/files/${props.image.id}/add`, { tag })
        props.image.tags.push(tag)
        newTag.value = ''
        toast.success('标签已添加')
    } catch (e) {
        console.error(e)
        // toast.error('添加标签失败')
        // Revert not needed as we didn't push if failed usually, wait for success
    }
}

async function handleRemoveTag(tag: string) {
    if (!props.image || !props.image.tags) return
    try {
        await api.post(`/tags/files/${props.image.id}/remove`, { tag })
        const idx = props.image.tags.indexOf(tag)
        if (idx !== -1) props.image.tags.splice(idx, 1)
        toast.success('标签已移除')
    } catch (e) {
        console.error(e)
        toast.error('移除标签失败')
    }
}

// 开始编辑文件名
function startEditName() {
    if (!props.image) return
    // 获取不带扩展名的文件名
    const name = props.image.originalName
    const lastDot = name.lastIndexOf('.')
    editingName.value = lastDot > 0 ? name.substring(0, lastDot) : name
    isEditingName.value = true
}

// 取消编辑
function cancelEditName() {
    isEditingName.value = false
    editingName.value = ''
}

// 保存文件名
async function saveFileName() {
    if (!props.image || !editingName.value.trim()) return

    const newName = editingName.value.trim()
    const oldName = props.image.originalName
    const lastDot = oldName.lastIndexOf('.')
    const ext = lastDot > 0 ? oldName.substring(lastDot) : ''
    const fullNewName = newName + ext

    // 如果名称没变，直接退出编辑模式
    if (fullNewName === oldName) {
        cancelEditName()
        return
    }

    isRenaming.value = true
    try {
        // 调用后端 PATCH /api/files/:id 接口更新文件名
        const response = await api.patch(`/files/${props.image.id}`, { originalName: fullNewName })

        if (response.data.success) {
            // 更新本地数据
            props.image.originalName = fullNewName
            if (props.image.filename !== undefined) {
                props.image.filename = fullNewName
            }

            toast.success('文件名已更新')
            emit('renamed', props.image.id, fullNewName, props.image.id)
        }
        cancelEditName()
    } catch (e) {
        console.error('Failed to rename image:', e)
        toast.error('重命名失败')
    } finally {
        isRenaming.value = false
    }
}

const imageUrl = computed(() => {
    if (!props.image) return ''
    // If image.url is relative /api/serve/..., it's fine.
    return props.image.url
})

const formattedSize = computed(() => {
    if (!props.image) return ''
    const mb = props.image.size / 1024 / 1024
    return mb < 1 ? `${(props.image.size / 1024).toFixed(1)} KB` : `${mb.toFixed(1)} MB`
})

const aliasList = computed(() => {
    if (!props.image || !Array.isArray(props.image.aliases)) return []
    return props.image.aliases
        .map((x) => String(x || '').trim())
        .filter(Boolean)
})

async function handleDelete() {
    if (!props.image) return
    
    // First click: show confirmation
    if (!confirmDelete.value) {
        confirmDelete.value = true
        // Auto-reset after 3 seconds if user doesn't confirm
        setTimeout(() => {
            confirmDelete.value = false
        }, 3000)
        return
    }
    
    // Second click: actually delete
    isDeleting.value = true
    try {
        // Use single file delete API (DELETE /api/files/:id)
        await api.delete(`/files/${props.image.id}`)

        toast.success('图片已删除')
        emit('deleted', props.image.id)
        emit('update:open', false)
    } catch (e) {
        console.error('Failed to delete image:', e)
        toast.error('删除图片失败')
    } finally {
        isDeleting.value = false
        confirmDelete.value = false
    }
}

function encodeAlbumIdForApi(id: string): string {
    return id
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')
}

function pushAnnotateLog(message: string, timestamp?: number) {
    const ts = new Date(timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour12: false })
    annotateLogs.value.push(`[${ts}] ${message}`)
    if (annotateLogs.value.length > 8) {
        annotateLogs.value.splice(0, annotateLogs.value.length - 8)
    }
}

async function refreshCurrentImage() {
    if (!props.image) return
    try {
        const res = await api.get(`/files/${props.image.id}`)
        const data = res.data?.data
        if (data) {
            Object.assign(props.image, data)
        }
    } catch (e) {
        console.error('Failed to refresh image after annotation:', e)
    }
}

async function handleAnnotateImage() {
    if (!props.image) return
    if (!props.image.albumId) {
        toast.error('当前图片不在相册内，无法使用相册标注接口')
        return
    }
    if (isAnnotating.value) return

    isAnnotating.value = true
    annotateLogs.value = []
    pushAnnotateLog('开始单图标注...')

    const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token')
    const params = new URLSearchParams({
        overwrite: 'true',
        concurrency: '1',
        fileId: props.image.id,
    })
    if (token) {
        params.set('password', token)
    }
    const hints = annotateHint.value.trim()
    if (hints) {
        params.set('hints', hints)
    }

    const url = `/api/albums/${encodeAlbumIdForApi(props.image.albumId)}/annotate/stream?${params.toString()}`

    try {
        let doneData: any = null
        await new Promise<void>((resolve, reject) => {
            const es = new EventSource(url)

            const parse = (text: string) => {
                try {
                    return JSON.parse(text)
                } catch {
                    return null
                }
            }

            es.addEventListener('start', (evt: MessageEvent) => {
                const data = parse(evt.data) as any
                pushAnnotateLog(
                    `任务启动：扫描 ${data?.scanned ?? data?.total ?? 0}，待处理 ${data?.total ?? 0}，跳过 ${data?.skipped ?? 0}`,
                    Number(data?.timestamp || Date.now()),
                )
            })

            es.addEventListener('progress', (evt: MessageEvent) => {
                const data = parse(evt.data) as any
                pushAnnotateLog(`处理中：${data?.filename || 'unknown'}`, Number(data?.timestamp || Date.now()))
            })

            es.addEventListener('item', (evt: MessageEvent) => {
                const data = parse(evt.data) as any
                if (data?.status === 'success') {
                    pushAnnotateLog(`成功：${data?.filename || 'unknown'}`, Number(data?.timestamp || Date.now()))
                } else {
                    pushAnnotateLog(`失败：${data?.filename || 'unknown'} ${data?.error || ''}`, Number(data?.timestamp || Date.now()))
                }
            })

            es.addEventListener('done', async (evt: MessageEvent) => {
                const data = parse(evt.data) as any
                doneData = data
                const skipped = Number(data?.skipped || 0)
                pushAnnotateLog(
                    `完成：成功 ${data?.success ?? 0}，失败 ${data?.failed ?? 0}，跳过 ${skipped}`,
                    Number(data?.timestamp || Date.now()),
                )
                es.close()
                await refreshCurrentImage()
                resolve()
            })

            es.onerror = () => {
                es.close()
                reject(new Error('标注流连接中断'))
            }
        })
        const successCount = Number(doneData?.success || 0)
        const skippedCount = Number(doneData?.skipped || 0)
        if (successCount > 0) {
            toast.success('图片标注完成')
        } else if (skippedCount > 0) {
            toast.info('已跳过：该图片已有标注')
        } else {
            toast.info('图片无新增标注')
        }
    } catch (e: any) {
        console.error('Single image annotation failed:', e)
        toast.error(`图片标注失败：${e?.message || 'unknown error'}`)
        pushAnnotateLog(`任务异常：${e?.message || 'unknown error'}`)
    } finally {
        isAnnotating.value = false
    }
}

function handleDownload() {
    if (!props.image) return
    const link = document.createElement('a')
    link.href = imageUrl.value
    link.download = props.image.originalName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
}

// 获取完整的图片链接
const fullImageUrl = computed(() => {
    if (!props.image) return ''
    return window.location.origin + props.image.url
})

// 复制链接到剪贴板
async function handleCopyLink() {
    if (!props.image) return
    try {
        await navigator.clipboard.writeText(fullImageUrl.value)
        toast.success('链接已复制到剪贴板')
    } catch (err) {
        // 降级方案
        const input = document.createElement('input')
        input.value = fullImageUrl.value
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
        toast.success('链接已复制到剪贴板')
    }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-[95vw] w-full h-[90vh] p-0 gap-0 bg-background/95 backdrop-blur overflow-hidden flex flex-col md:flex-row border-none shadow-2xl">
      
      <!-- Image Display Area -->
      <div class="flex-1 relative bg-black/5 flex items-center justify-center h-full group/image">
        <template v-if="image">
            <img 
              :src="imageUrl" 
              class="max-w-full max-h-full object-contain drop-shadow-2xl min-w-[50%] min-h-[50%]" 
              :style="{ 
                aspectRatio: image.width && image.height ? `${image.width}/${image.height}` : 'auto',
                objectFit: 'contain'
              }"
            />
            
            <!-- Navigation Arrows -->
            <div class="absolute inset-y-0 left-0 w-24 flex items-center justify-start pl-4 opacity-0 group-hover/image:opacity-100 transition-opacity">
                <Button 
                    variant="secondary" 
                    size="icon" 
                    class="h-12 w-12 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md border-none text-white shadow-lg"
                    @click="emit('prev')"
                >
                    <ChevronLeft class="h-8 w-8" />
                </Button>
            </div>

            <div class="absolute inset-y-0 right-0 w-24 flex items-center justify-end pr-4 opacity-0 group-hover/image:opacity-100 transition-opacity">
                <Button 
                    variant="secondary" 
                    size="icon" 
                    class="h-12 w-12 rounded-full bg-black/20 hover:bg-black/40 backdrop-blur-md border-none text-white shadow-lg"
                    @click="emit('next')"
                >
                    <ChevronRight class="h-8 w-8" />
                </Button>
            </div>
        </template>
      </div>

      <!-- Sidebar / Info Panel -->
      <div v-if="showInfo" class="w-full md:w-80 border-l bg-background p-6 flex flex-col gap-6 overflow-y-auto shrink-0 transition-all">
        <div class="flex items-center justify-between">
            <h3 class="font-semibold text-lg">详情</h3>
            <div class="flex gap-2">
                 <Button variant="ghost" size="icon" @click="showInfo = false" class="md:hidden">
                    <X class="h-4 w-4" />
                </Button>
            </div>
        </div>

        <div v-if="image" class="space-y-4">
            <div>
                <label class="text-xs text-muted-foreground font-medium">文件名</label>
                <!-- 编辑模式 -->
                <div v-if="isEditingName" class="flex items-center gap-2 mt-1">
                    <Input
                        v-model="editingName"
                        class="h-8 text-sm flex-1"
                        :disabled="isRenaming"
                        @keyup.enter="saveFileName"
                        @keyup.escape="cancelEditName"
                        autofocus
                    />
                    <Button
                        size="sm"
                        variant="ghost"
                        class="h-8 w-8 p-0"
                        @click="saveFileName"
                        :disabled="isRenaming || !editingName.trim()"
                    >
                        <Check class="h-4 w-4 text-green-600" />
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        class="h-8 w-8 p-0"
                        @click="cancelEditName"
                        :disabled="isRenaming"
                    >
                        <X class="h-4 w-4 text-muted-foreground" />
                    </Button>
                </div>
                <!-- 显示模式 -->
                <div v-else class="flex items-center gap-2 group/filename">
                    <p class="text-sm break-all flex-1">{{ image.originalName }}</p>
                    <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 w-6 p-0 opacity-0 group-hover/filename:opacity-100 transition-opacity shrink-0"
                        @click="startEditName"
                    >
                        <Pencil class="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </Button>
                </div>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="text-xs text-muted-foreground font-medium">尺寸</label>
                    <p class="text-sm" v-if="image.width">{{ image.width }} x {{ image.height }}</p>
                    <p class="text-sm" v-else>-</p>
                </div>
                <div>
                    <label class="text-xs text-muted-foreground font-medium">大小</label>
                    <p class="text-sm">{{ formattedSize }}</p>
                </div>
            </div>

            <div>
                <label class="text-xs text-muted-foreground font-medium">日期</label>
                <p class="text-sm">{{ new Date(image.createdAt).toLocaleString() }}</p>
            </div>

            <div>
                <label class="text-xs text-muted-foreground font-medium">标注简述</label>
                <p class="text-sm leading-6">{{ image.caption || '暂无标注' }}</p>
            </div>

            <div>
                <label class="text-xs text-muted-foreground font-medium">语义描述</label>
                <p class="text-sm leading-6 whitespace-pre-wrap">{{ image.semanticDescription || '暂无语义描述' }}</p>
            </div>

            <div class="space-y-2">
                 <label class="text-xs text-muted-foreground font-medium">检索短语 aliases</label>
                 <div class="flex flex-wrap gap-2">
                    <span
                        v-for="alias in aliasList"
                        :key="alias"
                        class="px-2 py-0.5 bg-muted text-foreground rounded text-xs"
                    >
                        {{ alias }}
                    </span>
                    <span v-if="aliasList.length === 0" class="text-xs text-muted-foreground italic px-2">暂无 aliases</span>
                 </div>
            </div>

            <div class="space-y-2">
                <label class="text-xs text-muted-foreground font-medium">单图标注（可选注入关键词）</label>
                <div class="flex gap-2">
                    <Input
                        v-model="annotateHint"
                        class="h-8 text-xs"
                        placeholder="例如：幸福, 摸头, 可爱"
                        :disabled="isAnnotating"
                    />
                    <Button size="sm" variant="outline" class="h-8 px-3" :disabled="isAnnotating" @click="handleAnnotateImage">
                        <Wand2 class="h-4 w-4 mr-1" />
                        {{ isAnnotating ? '标注中' : '标注图片' }}
                    </Button>
                </div>
                <div v-if="annotateLogs.length > 0" class="max-h-24 overflow-auto rounded-md border p-2 text-xs text-muted-foreground space-y-1">
                    <div v-for="(line, idx) in annotateLogs" :key="`${idx}-${line}`">{{ line }}</div>
                </div>
            </div>

            <div class="space-y-2">
                 <label class="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Tag class="h-3 w-3" /> 标签
                 </label>
                 <div class="flex flex-wrap gap-2">
                    <span 
                        v-for="tag in image.tags" 
                        :key="tag" 
                        class="pl-2 pr-1 py-0.5 bg-secondary text-secondary-foreground rounded text-xs flex items-center gap-1 group"
                    >
                        {{ tag }}
                        <button class="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity" @click="handleRemoveTag(tag)">
                            <X class="h-3 w-3" />
                        </button>
                    </span>
                    <span v-if="!image.tags?.length" class="text-xs text-muted-foreground italic px-2">暂无标签</span>
                 </div>
                 
                 <div class="flex items-center gap-2 mt-2">
                    <Input 
                        v-model="newTag" 
                        class="h-8 text-xs" 
                        placeholder="添加标签..." 
                        @keyup.enter="handleAddTag"
                    />
                    <Button size="sm" variant="outline" class="h-8 px-2" @click="handleAddTag" :disabled="!newTag.trim()">
                        <Plus class="h-4 w-4" />
                    </Button>
                 </div>
            </div>
        </div>

        <div class="mt-auto pt-6 border-t flex flex-col gap-3">
             <!-- 操作按钮组 -->
             <div class="grid grid-cols-2 gap-2">
                <Button variant="outline" class="w-full" @click="handleDownload">
                    <Download class="h-4 w-4 mr-2" />
                    下载
                </Button>
                <Button variant="outline" class="w-full" @click="handleCopyLink">
                    <Link2 class="h-4 w-4 mr-2" />
                    复制链接
                </Button>
             </div>

             <!-- 删除按钮 -->
             <Button
                variant="destructive"
                class="w-full transition-all"
                :class="{ 'animate-pulse': confirmDelete }"
                @click="handleDelete"
                :disabled="isDeleting"
             >
                <Trash2 class="h-4 w-4 mr-2" />
                {{ confirmDelete ? '点击确认删除' : '删除图片' }}
             </Button>
             <p v-if="confirmDelete" class="text-xs text-center text-destructive animate-in fade-in">
                再次点击确认删除，3秒后自动取消
             </p>
        </div>
      </div>

      <!-- Controls Overlay (Absolute) -->
       <div class="absolute top-4 right-4 flex items-center gap-2 z-50">
          <Button v-if="!showInfo" variant="secondary" size="icon" @click="showInfo = true">
             <Info class="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" @click="handleDownload">
             <Download class="h-4 w-4" />
          </Button>
          <DialogClose as-child>
            <Button variant="secondary" size="icon">
                <X class="h-4 w-4" />
            </Button>
          </DialogClose>
       </div>

    </DialogContent>
  </Dialog>
</template>
