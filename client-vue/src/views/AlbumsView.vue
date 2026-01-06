<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAlbumStore, type Album } from '@/stores/albums'
import { useUploadStore } from '@/stores/upload'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Folder, Plus, Trash2, FolderOpen } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()
const store = useAlbumStore()
const uploadStore = useUploadStore()
const newAlbumName = ref('')
const isDialogOpen = ref(false)

function navigateToAlbum(album: Album) {
    router.push(`/admin/albums/${album.slug}`)
}

// Delete logic
const isDeleteConfirmOpen = ref(false)
const albumToDelete = ref<Album | null>(null)

function openDeleteConfirm(album: Album) {
  albumToDelete.value = album
  isDeleteConfirmOpen.value = true
}

async function confirmDelete() {
  if (albumToDelete.value) {
    await store.deleteAlbum(albumToDelete.value.id)
    isDeleteConfirmOpen.value = false
    albumToDelete.value = null
  }
}

watch(() => uploadStore.isUploading, (newVal, oldVal) => {
    if (!newVal && oldVal) {
        store.fetchAlbums()
    }
})

onMounted(() => {
  store.fetchAlbums()
})

async function handleCreate() {
  if (!newAlbumName.value) return
  const success = await store.createAlbum(newAlbumName.value)
  if (success) {
    isDialogOpen.value = false
    newAlbumName.value = ''
  }
}
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

    <div v-if="store.isLoading" class="text-center py-10 text-muted-foreground">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="store.albums.length === 0" class="text-center py-20 border-2 border-dashed rounded-lg text-muted-foreground">
      <FolderOpen class="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p>{{ t('albums.noAlbums') }}</p>
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      <Card
        v-for="album in store.albums"
        :key="album.id"
        class="group hover:shadow-md transition-shadow cursor-pointer relative"
        @click="navigateToAlbum(album)"
      >
        <CardHeader class="p-4 pb-2">
          <div class="flex justify-between items-start">
            <Folder class="h-8 w-8 text-blue-500 fill-blue-500/20" />
             <!-- Delete button (visible on hover) -->
            <Button
              variant="ghost"
              size="icon"
              class="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 -mr-2 -mt-2 z-10 relative"
              @click.stop="openDeleteConfirm(album)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent class="p-4 pt-2">
          <div class="block">
            <h3 class="font-medium truncate">{{ album.name }}</h3>
            <p class="text-xs text-muted-foreground mt-1">{{ t('albums.items', { count: album.fileCount || 0 }) }}</p>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- Delete Confirmation Dialog -->
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
  </div>
</template>
