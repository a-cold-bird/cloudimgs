<script setup lang="ts">
import { useUploadStore } from '@/stores/upload'
import { useAlbumStore } from '@/stores/albums'
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import UploadZone from './UploadZone.vue'
import { Loader2, CheckCircle2, XCircle, X, StopCircle, Ban } from 'lucide-vue-next'
import { Progress } from '@/components/ui/progress'
import { onMounted, computed } from 'vue'

const store = useUploadStore()
const albumStore = useAlbumStore()

// Check if there are any pending or uploading items
const hasActiveUploads = computed(() => 
    store.queue.some(i => i.status === 'pending' || i.status === 'uploading')
)

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
        <DialogTitle>Upload Images</DialogTitle>
        <DialogDescription>
          Drag and drop images to upload them to your cloud.
        </DialogDescription>
      </DialogHeader>
      
      <div class="space-y-4 py-4">
        <!-- Album Selector -->
         <div class="space-y-2">
            <label class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Select Album (Optional)
            </label>
            <Select v-model="store.selectedAlbumId">
              <SelectTrigger>
                <SelectValue placeholder="Select an album" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root_placeholder_value">No Album (Root)</SelectItem>
                <SelectItem v-for="album in albumStore.albums" :key="album.id" :value="album.id">
                  {{ album.name }}
                </SelectItem>
              </SelectContent>
            </Select>
         </div>

        <UploadZone />
        
        <div v-if="store.queue.length > 0" class="border rounded-md">
            <div class="flex items-center justify-between p-2 border-b bg-muted/50">
                <span class="text-sm font-medium">Queue ({{ store.queue.length }})</span>
                <div class="flex gap-2">
                    <Button 
                        variant="destructive" 
                        size="sm" 
                        @click="store.cancelAll" 
                        v-if="hasActiveUploads"
                    >
                        <Ban class="mr-1 h-3 w-3" />
                        Cancel All
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        @click="store.clearCompleted" 
                        v-if="store.queue.some(i => i.status === 'success' || i.status === 'cancelled')"
                    >
                        Clear Done
                    </Button>
                </div>
            </div>
            <div class="max-h-[200px] overflow-y-auto p-2 space-y-2">
                <div v-for="(item, index) in store.queue" :key="index" class="flex items-center gap-3 text-sm p-2 rounded hover:bg-accent group">
                    <div class="flex-1 truncate">
                        {{ item.file.name }}
                    </div>
                    
                    <div class="w-20" v-if="item.status === 'uploading'">
                        <Progress :model-value="item.progress" class="h-2" />
                    </div>
                    
                    <div class="flex-none flex items-center gap-1">
                        <!-- Status icon -->
                        <Loader2 v-if="item.status === 'pending'" class="h-4 w-4 text-muted-foreground" />
                        <Loader2 v-else-if="item.status === 'uploading'" class="h-4 w-4 animate-spin text-blue-500" />
                        <CheckCircle2 v-else-if="item.status === 'success'" class="h-4 w-4 text-green-500" />
                        <Ban v-else-if="item.status === 'cancelled'" class="h-4 w-4 text-orange-500" />
                        <XCircle v-else class="h-4 w-4 text-red-500" />
                        
                        <!-- Action button -->
                        <button 
                            v-if="item.status === 'uploading'"
                            @click="store.cancelItem(index)"
                            class="p-1 rounded hover:bg-destructive/20 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Cancel upload"
                        >
                            <StopCircle class="h-4 w-4" />
                        </button>
                        <button 
                            v-else
                            @click="store.removeItem(index)"
                            class="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Remove from queue"
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

