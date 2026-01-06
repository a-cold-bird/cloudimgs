<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useGalleryStore } from '@/stores/gallery'
import { useUploadStore } from '@/stores/upload'
import ImageCard from './ImageCard.vue'
import { Loader2, Trash2, UploadCloud, RefreshCw, Search, X, Ban } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import ImageDetailModal from './ImageDetailModal.vue'
import api from '@/services/api'
import { toast } from 'vue-sonner'
import { useIntersectionObserver, useDebounceFn } from '@vueuse/core'

const props = defineProps<{
  albumId?: string
  title?: string
}>()

const store = useGalleryStore()
const uploadStore = useUploadStore()
const selectedImage = ref<any>(null)
const isDetailOpen = ref(false)
const searchInput = ref('')

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

// Bulk Selection
const selectedIds = ref<Set<string>>(new Set())
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
}

function selectAll() {
    store.images.forEach(img => selectedIds.value.add(img.id))
}

function deselectAll() {
    selectedIds.value.clear()
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
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousedown', onWindowMouseDown)
  window.removeEventListener('mouseup', onWindowMouseUp)
  if (internalDragTimeout) clearTimeout(internalDragTimeout)
})

</script>

<template>
  <div 
    class="space-y-6 relative min-h-[400px]"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
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
    <div class="flex flex-col gap-2 sticky -top-6 -mt-6 pt-7 pb-2 bg-background/95 backdrop-blur z-40 border-b px-1">
       <!-- Upload Progress Bar -->
       <div v-if="uploadStore.isUploading" class="w-full space-y-2 animate-in fade-in slide-in-from-top-2">
            <div class="flex justify-between items-center text-xs text-muted-foreground">
                <div class="flex items-center gap-2">
                    <Loader2 class="h-3 w-3 animate-spin" />
                    <span>正在上传 {{ uploadStore.queue.filter(i => i.status === 'pending' || i.status === 'uploading').length }} 个文件 ({{ uploadProgressTotal }}%)</span>
                </div>
                <Button variant="ghost" size="sm" class="h-6 text-[10px] text-destructive hover:bg-destructive/10" @click="uploadStore.cancelAll()">
                    <Ban class="h-3 w-3 mr-1" /> 取消所有上传
                </Button>
            </div>
            <Progress :model-value="uploadProgressTotal" class="h-1" />
       </div>

      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div class="flex items-center gap-4">
            <h2 class="text-2xl font-bold tracking-tight">{{ title || '最近上传' }}</h2>
            <span v-if="isSelecting" class="text-sm font-medium bg-primary/10 text-primary px-3 py-1 rounded-full">
                已选择 {{ selectedIds.size }} 项
            </span>
        </div>

        <div class="flex items-center gap-2">
            <!-- Search Input -->
            <div class="relative w-full sm:w-64 group">
                <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input 
                    v-model="searchInput" 
                    placeholder="搜索图片名称..." 
                    class="pl-9 h-9 text-sm bg-muted/50 border-transparent focus-visible:ring-1 focus-visible:ring-primary transition-all"
                />
                <button 
                    v-if="searchInput" 
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    @click="clearSearch"
                >
                    <X class="h-3 w-3" />
                </button>
            </div>

            <div class="flex items-center gap-1 border-l pl-2 ml-1">
                <template v-if="isSelecting">
                    <Button variant="ghost" size="sm" @click="selectAll" class="text-xs font-semibold">全选</Button>
                    <Button variant="ghost" size="sm" @click="deselectAll" class="text-xs font-semibold">取消</Button>
                    <Button variant="destructive" size="sm" @click="deleteSelected" class="shadow-sm">
                        <Trash2 class="h-4 w-4 mr-2" /> 删除
                    </Button>
                </template>
                <template v-else>
                    <Button variant="ghost" size="icon" @click="store.fetchImages(true, albumId)" :disabled="store.isLoading || uploadStore.isUploading">
                        <RefreshCw class="h-4 w-4" :class="{'animate-spin': store.isLoading || uploadStore.isUploading}" />
                    </Button>
                    <Button variant="outline" size="sm" @click="selectAll" class="font-semibold text-xs transition-all hover:bg-primary hover:text-primary-foreground">选择</Button>
                </template>
            </div>
        </div>
      </div>
    </div>

    <div v-if="store.isLoading && store.images.length === 0" class="flex justify-center p-12">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <!-- Waterfall Layout -->
    <div v-else-if="store.images.length > 0" class="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-4 space-y-4">
      <ImageCard 
        v-for="image in store.images" 
        :key="image.id" 
        :image="image"
        :selected="selectedIds.has(image.id)"
        @click="onImageClick(image)"
        @toggle="toggleSelect"
        class="mb-4 inline-block w-full"
      />
    </div>

    <div v-else class="text-center py-20 bg-muted/30 rounded-xl border border-dashed">
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
