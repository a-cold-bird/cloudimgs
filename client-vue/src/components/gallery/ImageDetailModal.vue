<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { type ImageItem } from '@/stores/gallery' // Fixed import path
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { X, Download, Info, Tag, Trash2, Plus, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import api from '@/services/api'
import { toast } from 'vue-sonner'

const props = defineProps<{
  image: ImageItem | null
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'deleted', id: string): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

const showInfo = ref(true)
const newTag = ref('')
const isDeleting = ref(false)
const confirmDelete = ref(false)

// Reset confirm state when image changes or modal closes
watch(() => props.image, () => {
    confirmDelete.value = false
})
watch(() => props.open, (val) => {
    if (!val) confirmDelete.value = false
})

async function handleAddTag() {
    if (!props.image || !newTag.value.trim()) return
    const tag = newTag.value.trim()
    
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
    if (!props.image) return
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

function handleDownload() {
    if (!props.image) return
    const link = document.createElement('a')
    link.href = imageUrl.value
    link.download = props.image.originalName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
                <p class="text-sm break-all">{{ image.originalName }}</p>
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
                    <span v-if="image.tags.length === 0" class="text-xs text-muted-foreground italic px-2">暂无标签</span>
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

        <div class="mt-auto pt-6 border-t flex flex-col gap-2">
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
                ⚠️ 再次点击确认删除，3秒后自动取消
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
