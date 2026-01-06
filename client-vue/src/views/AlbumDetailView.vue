<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAlbumStore, type Album } from '@/stores/albums'
import { useUploadStore } from '@/stores/upload'
import ImageGallery from '@/components/gallery/ImageGallery.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ArrowLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const store = useAlbumStore()
const uploadStore = useUploadStore()
const album = ref<Album | null>(null)
const loading = ref(true)

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
    if (!album.value) return;
    // v-model 已经自动更新了 album.isPublic，只需要调用 API
    const success = await store.updateAlbum(album.value.id, { isPublic: val });
    if (!success) {
        // API 失败，回滚 UI 状态
        album.value.isPublic = !val;
    }
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
  <div class="space-y-6">
    <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
            <Button variant="ghost" size="icon" @click="router.back()">
                <ArrowLeft class="h-4 w-4" />
            </Button>
            <div>
                <h2 class="text-2xl font-bold tracking-tight" v-if="album">{{ album.name }}</h2>
                <h2 class="text-2xl font-bold tracking-tight" v-else>Loading...</h2>
                <p class="text-muted-foreground" v-if="album">
                    {{ album.isPublic ? '公开相册' : '私有相册' }} · {{ album.fileCount || 0 }} items
                </p>
            </div>
        </div>

        <div v-if="album" class="flex items-center space-x-2">
            <Switch v-model="album.isPublic" @update:model-value="handlePublicToggle" id="public-mode" />
            <label for="public-mode" class="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                {{ album.isPublic ? '公开' : '私有' }}
            </label>
        </div>
    </div>

    <div v-if="loading" class="py-10 text-center">
        Loading...
    </div>
    
    <ImageGallery v-else-if="album" :album-id="album.id" :title="album.name" />
    
    <div v-else class="py-10 text-center text-muted-foreground">
        Album not found.
    </div>
  </div>
</template>

