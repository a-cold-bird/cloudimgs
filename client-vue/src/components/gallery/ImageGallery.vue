<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useGalleryStore } from '@/stores/gallery'
import type { ImageItem } from '@/stores/gallery'
import { useUploadStore } from '@/stores/upload'
import ImageCard from './ImageCard.vue'
import ImageList from './ImageList.vue'
import { Loader2, Trash2, UploadCloud, RefreshCw, Search, X, LayoutGrid, List as ListIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import ImageDetailModal from './ImageDetailModal.vue'
import api from '@/services/api'
import { toast } from 'vue-sonner'
import { useIntersectionObserver, useDebounceFn } from '@vueuse/core'

const props = withDefaults(defineProps<{
  albumId?: string
  title?: string
  showTitle?: boolean
}>(), {
  showTitle: true
})

// ==================== 拖动框选功能 ====================
const galleryContainer = ref<HTMLElement | null>(null)
const isBoxSelecting = ref(false)
const isBoxDragging = ref(false) // 实际开始拖动（移动超过阈值）
const boxSelectStart = ref({ x: 0, y: 0 })
const boxSelectCurrent = ref({ x: 0, y: 0 })
const DRAG_THRESHOLD = 5 // 拖动阈值（像素）
// 框选时临时记录的选中项（用于动态更新）
const boxSelectingIds = ref<Set<string>>(new Set())

// 使用视口坐标计算选择框
const boxSelectRect = computed(() => {
    const x1 = Math.min(boxSelectStart.value.x, boxSelectCurrent.value.x)
    const y1 = Math.min(boxSelectStart.value.y, boxSelectCurrent.value.y)
    const x2 = Math.max(boxSelectStart.value.x, boxSelectCurrent.value.x)
    const y2 = Math.max(boxSelectStart.value.y, boxSelectCurrent.value.y)
    return {
        left: x1,
        top: y1,
        width: x2 - x1,
        height: y2 - y1
    }
})

// 检测两个矩形是否相交
function rectsIntersect(r1: DOMRect, r2: { left: number, top: number, width: number, height: number }) {
    return !(r1.right < r2.left ||
             r1.left > r2.left + r2.width ||
             r1.bottom < r2.top ||
             r1.top > r2.top + r2.height)
}

// 开始框选 - 使用全局事件
function onGalleryMouseDown(e: MouseEvent) {
    // 只响应左键
    if (e.button !== 0) return
    const target = e.target as HTMLElement

    // 如果点击在输入框、按钮、链接等交互元素上，不开始框选
    if (target.closest('input, button, a, [role="button"]')) return

    // 使用视口坐标（clientX/clientY）
    boxSelectStart.value = { x: e.clientX, y: e.clientY }
    boxSelectCurrent.value = { x: e.clientX, y: e.clientY }
    isBoxSelecting.value = true
    isBoxDragging.value = false
    boxSelectingIds.value = new Set()

    // 注意：不在这里阻止默认行为，让点击可以正常触发
    // 只有在真正开始拖动后才阻止
}

// 框选过程中
function onGalleryMouseMove(e: MouseEvent) {
    if (!isBoxSelecting.value) return

    boxSelectCurrent.value = { x: e.clientX, y: e.clientY }

    // 计算移动距离，判断是否超过阈值开始真正的拖动
    const dx = Math.abs(e.clientX - boxSelectStart.value.x)
    const dy = Math.abs(e.clientY - boxSelectStart.value.y)

    if (!isBoxDragging.value && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
        isBoxDragging.value = true
        // 开始真正拖动时，阻止文本选择
        e.preventDefault()
    }

    if (isBoxDragging.value) {
        // 实时更新选中状态
        updateBoxSelection()
    }
}

// 更新框选中的图片 - 支持动态选择和取消选择
function updateBoxSelection() {
    if (!galleryContainer.value) return

    const cards = galleryContainer.value.querySelectorAll('[data-image-id]')
    const newBoxSelectingIds = new Set<string>()

    cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const imageId = card.getAttribute('data-image-id')
        if (!imageId) return

        // 直接使用视口坐标比较
        if (rectsIntersect(cardRect, boxSelectRect.value)) {
            newBoxSelectingIds.add(imageId)
        }
    })

    // 更新选中状态：添加新选中的，移除不再选中的
    // 只处理本次框选过程中的变化
    boxSelectingIds.value.forEach(id => {
        if (!newBoxSelectingIds.has(id)) {
            // 这个之前被框选选中，现在不在框内了，取消选择
            selectedIds.value.delete(id)
        }
    })

    newBoxSelectingIds.forEach(id => {
        selectedIds.value.add(id)
    })

    boxSelectingIds.value = newBoxSelectingIds
    triggerSelectedIdsUpdate()
}

// 结束框选
function onGalleryMouseUp() {
    if (!isBoxSelecting.value) return

    const wasDragging = isBoxDragging.value
    isBoxSelecting.value = false
    isBoxDragging.value = false
    boxSelectingIds.value = new Set()

    // 如果真正进行了拖动选择，返回 true 表示应该阻止后续的 click 事件
    return wasDragging
}

// 阻止框选后的点击事件传播
function onGalleryClick(e: MouseEvent) {
    // 如果刚刚完成了框选拖动，阻止点击事件
    // 使用一个短暂的标记来判断
    if (wasBoxSelecting) {
        e.stopPropagation()
        e.preventDefault()
        wasBoxSelecting = false
    }
}

let wasBoxSelecting = false

// 包装 mouseup 处理
function handleGlobalMouseUp() {
    if (isBoxSelecting.value && isBoxDragging.value) {
        wasBoxSelecting = true
        // 短暂延迟后重置，防止影响后续操作
        setTimeout(() => {
            wasBoxSelecting = false
        }, 100)
    }
    onGalleryMouseUp()
}

const store = useGalleryStore()
const uploadStore = useUploadStore()
const selectedImage = ref<any>(null)
const isDetailOpen = ref(false)
const searchInput = ref('')
const viewMode = ref<'grid' | 'list'>('grid')

// Restore view mode preference
const savedViewMode = localStorage.getItem('gallery_view_mode')
if (savedViewMode === 'grid' || savedViewMode === 'list') {
    viewMode.value = savedViewMode
}

watch(viewMode, (newMode) => {
    localStorage.setItem('gallery_view_mode', newMode)
})

// Search Logic
const debouncedSearch = useDebounceFn(() => {
    store.searchQuery = searchInput.value
    store.fetchImages(true, props.albumId)
}, 500)

watch(searchInput, () => {
    debouncedSearch()
})

function clearSearch() {
    searchInput.value = ''
    store.searchQuery = ''
    store.fetchImages(true, props.albumId)
}

// Infinite Scroll
const loadMoreTrigger = ref<HTMLElement | null>(null)
useIntersectionObserver(
  loadMoreTrigger,
  (entries) => {
    const entry = entries[0]
    if (entry?.isIntersecting && store.hasMore && !store.isLoading) {
      store.fetchImages(false, props.albumId)
    }
  },
  { threshold: 0.1 }
)

// Auto-refresh when upload finishes
watch(() => uploadStore.isUploading, (newVal, oldVal) => {
    if (!newVal && oldVal) {
        store.fetchImages(true, props.albumId)
    }
})

// Bulk Selection - 使用 reactive Set 确保响应式更新
const selectedIds = ref<Set<string>>(new Set())
const annotatingIds = ref<Set<string>>(new Set())
// 强制触发响应式更新的辅助函数
function triggerSelectedIdsUpdate() {
    selectedIds.value = new Set(selectedIds.value)
}
const isSelecting = computed(() => selectedIds.value.size > 0)
const uploadProgressTotal = computed(() => {
    if (uploadStore.queue.length === 0) return 0
    const total = uploadStore.queue.reduce((acc, item) => acc + item.progress, 0)
    return Math.round(total / uploadStore.queue.length)
})

function toggleSelect(id: string) {
    if (selectedIds.value.has(id)) {
        selectedIds.value.delete(id)
    } else {
        selectedIds.value.add(id)
    }
    triggerSelectedIdsUpdate()
}

function selectAll() {
    store.images.forEach(img => selectedIds.value.add(img.id))
    triggerSelectedIdsUpdate()
}

function deselectAll() {
    selectedIds.value.clear()
    triggerSelectedIdsUpdate()
}

function handleToggleAll(selected: boolean) {
    if (selected) {
        selectAll()
    } else {
        deselectAll()
    }
}

async function deleteSelected() {
    if (!confirm(`确定要删除选中的 ${selectedIds.value.size} 张图片吗？`)) return

    try {
        const ids = Array.from(selectedIds.value)
        await api.post('/files/batch/delete', { fileIds: ids })
        toast.success(`已删除 ${ids.length} 张图片`)
        
        // Optimistic update
        ids.forEach(id => {
            const idx = store.images.findIndex(i => i.id === id)
            if (idx !== -1) store.images.splice(idx, 1)
        })
        deselectAll()
    } catch (e) {
        console.error(e)
    }
}

// Image Navigation
function onImageClick(image: any) {
    selectedImage.value = image
    isDetailOpen.value = true
}

function onPrevImage() {
    if (!selectedImage.value) return
    const idx = store.images.findIndex(i => i.id === selectedImage.value.id)
    if (idx > 0) {
        selectedImage.value = store.images[idx - 1]
    }
}

function onNextImage() {
    if (!selectedImage.value) return
    const idx = store.images.findIndex(i => i.id === selectedImage.value.id)
    if (idx < store.images.length - 1) {
        selectedImage.value = store.images[idx + 1]
    } else if (store.hasMore) {
        // Load more and then try again? Simplified for now: only navigate within loaded
        store.fetchImages(false, props.albumId)
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (!isDetailOpen.value) return
    if (e.key === 'ArrowLeft') onPrevImage()
    if (e.key === 'ArrowRight') onNextImage()
}

function onImageDeleted(id: string) {
    const idx = store.images.findIndex(i => i.id === id)
    if (idx !== -1) {
        store.images.splice(idx, 1)
    }
}

function encodeAlbumIdForApi(id: string): string {
    return id
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')
}

function setAnnotating(imageId: string, annotating: boolean) {
    const next = new Set(annotatingIds.value)
    if (annotating) {
        next.add(imageId)
    } else {
        next.delete(imageId)
    }
    annotatingIds.value = next
}

function parseSsePayload(raw: string): any | null {
    try {
        return JSON.parse(raw)
    } catch {
        return null
    }
}

async function annotateSingleImage(image: ImageItem) {
    if (annotatingIds.value.has(image.id)) return

    const targetAlbumId = image.albumId || props.albumId
    if (!targetAlbumId) {
        toast.error('当前图片不在相册内，无法标注')
        return
    }

    setAnnotating(image.id, true)
    const params = new URLSearchParams({
        overwrite: 'true',
        concurrency: '1',
        fileId: image.id,
    })
    const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token')
    if (token) {
        params.set('password', token)
    }

    const url = `/api/albums/${encodeAlbumIdForApi(targetAlbumId)}/annotate/stream?${params.toString()}`

    try {
        let donePayload: any = null
        await new Promise<void>((resolve, reject) => {
            const es = new EventSource(url)
            let settled = false

            es.addEventListener('item', (evt: MessageEvent) => {
                const data = parseSsePayload(evt.data) as any
                if (data?.status === 'failed') {
                    toast.error(`标注失败：${data?.filename || image.originalName}`)
                }
            })

            es.addEventListener('done', (evt: MessageEvent) => {
                if (settled) return
                settled = true
                const data = parseSsePayload(evt.data) as any
                donePayload = data
                es.close()

                const failed = Number(data?.failed || 0)
                if (failed > 0) {
                    reject(new Error('标注任务失败'))
                    return
                }
                resolve()
            })

            es.onerror = () => {
                if (settled) return
                settled = true
                es.close()
                reject(new Error('标注流连接中断'))
            }
        })

        await store.fetchImages(true, props.albumId)
        if (selectedImage.value?.id === image.id) {
            const refreshed = store.images.find((item) => item.id === image.id)
            if (refreshed) {
                selectedImage.value = refreshed
            }
        }
        const successCount = Number(donePayload?.success || 0)
        const skippedCount = Number(donePayload?.skipped || 0)
        if (successCount > 0) {
            toast.success(`已完成标注：${image.originalName}`)
        } else if (skippedCount > 0) {
            toast.info(`已跳过（已有标注）：${image.originalName}`)
        } else {
            toast.info(`未产生新标注：${image.originalName}`)
        }
    } catch (e: any) {
        console.error('Failed to annotate image:', e)
        toast.error(`单图标注失败：${e?.message || 'unknown error'}`)
    } finally {
        setAnnotating(image.id, false)
    }
}

// Drag and Drop Upload
const isDragging = ref(false)
let dragCounter = 0

// 追踪页面内是否有鼠标按下（用于区分外部文件拖入和页面内图片拖动）
// 原理：外部拖入文件时，页面不会有 mousedown 事件；而页面内拖动时会先触发 mousedown
const isInternalDrag = ref(false)
let internalDragTimeout: ReturnType<typeof setTimeout> | null = null

function onWindowMouseDown() {
    isInternalDrag.value = true
}

function onWindowMouseUp() {
    // 延迟重置标记，给 drop 事件处理一些时间
    if (internalDragTimeout) clearTimeout(internalDragTimeout)
    internalDragTimeout = setTimeout(() => {
        isInternalDrag.value = false
    }, 100)
}

function onDragEnter(e: DragEvent) {
    e.preventDefault()
    dragCounter++

    // 如果是内部拖动（页面内鼠标按下后的拖动），不显示上传提示
    if (isInternalDrag.value) {
        return
    }

    isDragging.value = true
}

function onDragLeave(e: DragEvent) {
    e.preventDefault()
    dragCounter--
    if (dragCounter === 0) {
        isDragging.value = false
    }
}

function onDrop(e: DragEvent) {
    e.preventDefault()
    isDragging.value = false
    dragCounter = 0

    // 如果是内部拖动，不触发上传
    if (isInternalDrag.value) {
        return
    }

    if (e.dataTransfer?.files) {
        uploadStore.addToQueue(e.dataTransfer.files, props.albumId)
    }
}

onMounted(() => {
  store.fetchImages(true, props.albumId)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mousedown', onWindowMouseDown)
  window.addEventListener('mouseup', onWindowMouseUp)
  // 框选相关的全局事件
  window.addEventListener('mousemove', onGalleryMouseMove)
  window.addEventListener('mouseup', handleGlobalMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousedown', onWindowMouseDown)
  window.removeEventListener('mouseup', onWindowMouseUp)
  window.removeEventListener('mousemove', onGalleryMouseMove)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  if (internalDragTimeout) clearTimeout(internalDragTimeout)
})

</script>

<template>
  <div
    ref="galleryContainer"
    class="space-y-6 relative min-h-[400px]"
    :class="{ 'select-none': isBoxSelecting || isBoxDragging }"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop="onDrop"
    @mousedown="onGalleryMouseDown"
    @click.capture="onGalleryClick"
  >
    <!-- 框选矩形 - 使用 fixed 定位，直接使用视口坐标 -->
    <Teleport to="body">
      <div
          v-if="isBoxDragging && boxSelectRect.width > 5 && boxSelectRect.height > 5"
          class="fixed border-2 border-primary bg-primary/20 pointer-events-none z-[9999] rounded"
          :style="{
              left: boxSelectRect.left + 'px',
              top: boxSelectRect.top + 'px',
              width: boxSelectRect.width + 'px',
              height: boxSelectRect.height + 'px'
          }"
      />
    </Teleport>
    <!-- Drag Overlay -->
    <div 
        v-if="isDragging"
        class="absolute inset-0 z-50 bg-background/80 backdrop-blur border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center pointer-events-none"
    >
        <UploadCloud class="h-20 w-20 text-primary mb-4" />
        <h3 class="text-2xl font-bold text-primary">拖放文件到此处上传</h3>
        <p class="text-muted-foreground" v-if="albumId">上传至当前相册</p>
    </div>

    <!-- Header / Toolbar -->
    <div class="sticky top-0 z-40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <!-- Progress Bar -->
        <div v-if="uploadStore.isUploading" class="absolute inset-x-0 -bottom-px h-px bg-border overflow-hidden z-50">
             <div class="h-full bg-primary transition-all duration-300" :style="{ width: `${uploadProgressTotal}%` }"></div>
        </div>

        <div class="flex flex-col gap-4 p-4 sm:px-6">
             <!-- Top Row: Title & Actions -->
             <div class="flex items-center justify-between">
                  <div class="flex items-center gap-4">
                      <slot name="header-start" />
                      <h2 v-if="showTitle" class="text-2xl font-bold tracking-tight">{{ title || '最近上传' }}</h2>
                      <!-- Selection Badge -->
                      <div v-if="isSelecting" class="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                           <span class="bg-primary/10 text-primary text-xs font-medium px-2.5 py-0.5 rounded-full border border-primary/20">
                                已选择 {{ selectedIds.size }} 项
                           </span>
                           <Separator orientation="vertical" class="h-4" />
                           <div class="flex items-center gap-1">
                                <Button variant="ghost" size="sm" class="h-7 text-xs" @click="selectAll">全选</Button>
                                <Button variant="ghost" size="sm" class="h-7 text-xs" @click="deselectAll">取消</Button>
                           </div>
                      </div>
                  </div>

                  <div class="flex items-center gap-2">
                       <!-- Upload Status (Desktop) -->
                       <div v-if="uploadStore.isUploading" class="hidden md:flex items-center text-xs text-muted-foreground mr-2 animate-in fade-in">
                            <Loader2 class="h-3 w-3 animate-spin mr-1" />
                            {{ Math.round(uploadProgressTotal) }}%
                       </div>

                       <!-- Search Input -->
                       <div class="relative w-32 sm:w-48 lg:w-64 transition-all group">
                            <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input
                                v-model="searchInput"
                                placeholder="搜索..."
                                class="pl-8 h-8 text-xs bg-muted/50 border-transparent focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary transition-all"
                            />
                            <button
                                v-if="searchInput"
                                class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                @click="clearSearch"
                            >
                                <X class="h-3 w-3" />
                            </button>
                       </div>

                       <slot name="header-actions" />
                       <!-- View Mode Toggle -->
                       <div class="bg-muted/50 p-1 rounded-lg flex items-center gap-1 border hidden sm:flex">
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7 rounded-md"
                                :class="{'bg-background shadow-sm text-foreground': viewMode === 'grid', 'text-muted-foreground': viewMode !== 'grid'}"
                                @click="viewMode = 'grid'"
                            >
                                <LayoutGrid class="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                class="h-7 w-7 rounded-md"
                                :class="{'bg-background shadow-sm text-foreground': viewMode === 'list', 'text-muted-foreground': viewMode !== 'list'}"
                                @click="viewMode = 'list'"
                            >
                                <ListIcon class="h-4 w-4" />
                            </Button>
                       </div>

                       <Separator orientation="vertical" class="h-6 mx-1 hidden sm:block" />

                       <!-- Action Buttons -->
                       <template v-if="isSelecting">
                            <Button variant="destructive" size="sm" @click="deleteSelected" class="h-8 px-3 text-xs shadow-sm">
                                <Trash2 class="h-3.5 w-3.5 mr-1.5" /> 删除
                            </Button>
                       </template>
                       <template v-else>
                            <Button variant="outline" size="icon" @click="store.fetchImages(true, albumId)" :disabled="store.isLoading || uploadStore.isUploading" class="h-8 w-8">
                                <RefreshCw class="h-3.5 w-3.5" :class="{'animate-spin': store.isLoading || uploadStore.isUploading}" />
                            </Button>
                       </template>
                  </div>
             </div>
        </div>
    </div>

    <div v-if="store.isLoading && store.images.length === 0" class="flex justify-center p-12">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <!-- Grid View -->
    <div v-else-if="viewMode === 'grid' && store.images.length > 0" class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-4 space-y-4 px-4 sm:px-6 pb-4">
      <ImageCard
        v-for="image in store.images"
        :key="image.id"
        :image="image"
        :selected="selectedIds.has(image.id)"
        :annotating="annotatingIds.has(image.id)"
        @click="onImageClick(image)"
        @toggle="toggleSelect"
        @annotate="annotateSingleImage"
        class="mb-4 inline-block w-full"
      />
    </div>

    <!-- List View -->
    <div v-else-if="viewMode === 'list' && store.images.length > 0" class="px-4 sm:px-6 pb-4">
        <ImageList
            :images="store.images"
            :selected-ids="selectedIds"
            :annotating-ids="annotatingIds"
            @click="onImageClick"
            @toggle="toggleSelect"
            @toggle-all="handleToggleAll"
            @annotate="annotateSingleImage"
        />
    </div>

    <div v-else class="text-center py-20 bg-muted/30 rounded-xl border border-dashed mx-4 sm:mx-6">
         <Search class="h-10 w-10 mx-auto text-muted-foreground mb-4 opacity-20" />
         <p class="text-muted-foreground">未找到相关图片</p>
         <Button v-if="searchInput" variant="link" @click="clearSearch">清除搜索条件</Button>
    </div>

    <!-- Infinite Scroll Sentinel -->
    <div ref="loadMoreTrigger" class="flex justify-center p-12 mt-4 border-t border-dashed border-muted">
        <div v-if="store.isLoading" class="flex flex-col items-center gap-2 text-muted-foreground animate-in fade-in">
            <Loader2 class="h-6 w-6 animate-spin" />
            <span class="text-xs font-medium">加载更多...</span>
        </div>
        <div v-else-if="!store.hasMore && store.images.length > 0" class="flex flex-col items-center gap-2 text-muted-foreground opacity-30">
            <div class="h-px w-20 bg-muted"></div>
            <span class="text-xs uppercase tracking-widest font-bold">浏览完毕</span>
            <div class="h-px w-20 bg-muted"></div>
        </div>
    </div>

    <ImageDetailModal 
        v-model:open="isDetailOpen" 
        :image="selectedImage" 
        @deleted="onImageDeleted"
        @prev="onPrevImage"
        @next="onNextImage"
    />
  </div>
</template>

<style scoped>
.columns-2 { column-count: 2; }
@media (min-width: 640px) { .sm\:columns-3 { column-count: 3; } }
@media (min-width: 768px) { .md\:columns-4 { column-count: 4; } }
@media (min-width: 1024px) { .lg\:columns-5 { column-count: 5; } }
@media (min-width: 1280px) { .xl\:columns-6 { column-count: 6; } }

.break-inside-avoid {
  break-inside: avoid;
}

/* Ensure minimal jump when images load */
.columns-2, .sm\:columns-3, .md\:columns-4, .lg\:columns-5, .xl\:columns-6 {
  column-gap: 1rem;
}
</style>
