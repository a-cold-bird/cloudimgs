<script setup lang="ts">
import { useUploadStore } from '@/stores/upload'
import { useAlbumStore } from '@/stores/albums'
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import UploadZone from './UploadZone.vue'
import { Loader2, CheckCircle2, XCircle, X, StopCircle, Ban, Hash } from 'lucide-vue-next'
import { Progress } from '@/components/ui/progress'
import { onMounted, computed } from 'vue'

const store = useUploadStore()
const albumStore = useAlbumStore()

// Check if there are any pending or uploading items
const hasActiveUploads = computed(() =>
    store.queue.some(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'hashing')
)

// 格式化文件大小
function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 统计信息
const uploadStats = computed(() => {
    const total = store.queue.length
    const success = store.queue.filter(i => i.status === 'success').length
    const failed = store.queue.filter(i => i.status === 'error').length
    const pending = store.queue.filter(i => i.status === 'pending' || i.status === 'uploading' || i.status === 'hashing').length
    return { total, success, failed, pending }
})

onMounted(() => {
    // Ensure albums are loaded
    albumStore.fetchAlbums()
})

</script>

<template>
  <Dialog>
    <DialogTrigger as-child>
      <slot>
        <Button>Upload</Button>
      </slot>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[500px]">
      <DialogHeader>
        <DialogTitle>上传图片</DialogTitle>
        <DialogDescription>
          拖拽图片到此处或点击选择文件上传
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Album Selector -->
         <div class="space-y-2">
            <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              选择相册（可选）
            </label>
            <Select v-model="store.selectedAlbumId">
              <SelectTrigger>
                <SelectValue placeholder="选择相册" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root_placeholder_value">不选择（根目录）</SelectItem>
                <SelectItem v-for="album in albumStore.albums" :key="album.id" :value="album.id">
                  {{ album.name }}
                </SelectItem>
              </SelectContent>
            </Select>
         </div>

        <UploadZone />

        <div v-if="store.queue.length > 0" class="border rounded-md">
            <!-- 队列头部：统计信息和操作按钮 -->
            <div class="flex items-center justify-between p-2 border-b bg-muted/50">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">队列</span>
                    <span class="text-xs text-muted-foreground">
                        {{ uploadStats.success }}/{{ uploadStats.total }} 完成
                        <span v-if="uploadStats.failed > 0" class="text-red-500 ml-1">{{ uploadStats.failed }} 失败</span>
                    </span>
                </div>
                <div class="flex gap-2">
                    <Button
                        variant="destructive"
                        size="sm"
                        @click="store.cancelAll"
                        v-if="hasActiveUploads"
                    >
                        <Ban class="mr-1 h-3 w-3" />
                        全部取消
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        @click="store.clearCompleted"
                        v-if="store.queue.some(i => i.status === 'success' || i.status === 'cancelled' || i.status === 'error')"
                    >
                        清除已完成
                    </Button>
                </div>
            </div>

            <!-- 队列列表 -->
            <div class="max-h-[250px] overflow-y-auto p-2 space-y-1">
                <div v-for="(item, index) in store.queue" :key="index" class="flex items-center gap-3 text-sm p-2 rounded hover:bg-accent group">
                    <!-- 状态图标 -->
                    <div class="flex-none">
                        <Loader2 v-if="item.status === 'pending'" class="h-4 w-4 text-muted-foreground" />
                        <Hash v-else-if="item.status === 'hashing'" class="h-4 w-4 animate-pulse text-blue-500" title="计算校验和..." />
                        <Loader2 v-else-if="item.status === 'uploading'" class="h-4 w-4 animate-spin text-blue-500" />
                        <CheckCircle2 v-else-if="item.status === 'success'" class="h-4 w-4 text-green-500" />
                        <Ban v-else-if="item.status === 'cancelled'" class="h-4 w-4 text-orange-500" />
                        <XCircle v-else class="h-4 w-4 text-red-500" />
                    </div>

                    <!-- 文件信息 -->
                    <div class="flex-1 min-w-0">
                        <div class="truncate">{{ item.file.name }}</div>
                        <div class="text-xs text-muted-foreground flex items-center gap-2">
                            <span>{{ formatSize(item.file.size) }}</span>
                            <span v-if="item.status === 'hashing'" class="text-blue-500">校验中...</span>
                            <span v-else-if="item.status === 'uploading'" class="text-blue-500">{{ item.progress }}%</span>
                            <span v-else-if="item.retryCount && item.retryCount > 0" class="text-orange-500">
                                重试 {{ item.retryCount }}/3
                            </span>
                            <span v-else-if="item.error" class="text-red-500">{{ item.error }}</span>
                        </div>
                    </div>

                    <!-- 进度条 -->
                    <div class="w-16 flex-none" v-if="item.status === 'uploading'">
                        <Progress :model-value="item.progress" class="h-1.5" />
                    </div>

                    <!-- 操作按钮 -->
                    <div class="flex-none">
                        <button
                            v-if="item.status === 'uploading' || item.status === 'hashing'"
                            @click="store.cancelItem(index)"
                            class="p-1 rounded hover:bg-destructive/20 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            title="取消上传"
                        >
                            <StopCircle class="h-4 w-4" />
                        </button>
                        <button
                            v-else
                            @click="store.removeItem(index)"
                            class="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                            title="从队列移除"
                        >
                            <X class="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

