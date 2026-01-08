<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '@/services/api'
import { toast } from 'vue-sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { MapPin, Loader2 } from 'lucide-vue-next'

const { t } = useI18n()

interface MapPhoto {
  id: string
  filename: string
  lat: number
  lng: number
  date: string
  thumbUrl: string
  thumbhash?: string
}

const photos = ref<MapPhoto[]>([])
const isLoading = ref(true)

async function fetchMapPhotos() {
  isLoading.value = true
  try {
    const response = await api.get('/map/photos')
    photos.value = response.data.data || response.data || []
  } catch (error: any) {
    console.error('Failed to fetch map photos:', error)
    // 如果端点不存在，显示友好提示
    if (error.response?.status === 404) {
      photos.value = []
    } else {
      toast.error(t('map.loadFailed'))
    }
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  fetchMapPhotos()
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">{{ t('map.title') }}</h1>
      <p class="text-muted-foreground">{{ t('map.description') }}</p>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <Card v-if="photos.length === 0">
        <CardHeader>
          <div class="flex flex-col items-center py-8">
            <MapPin class="h-16 w-16 text-muted-foreground mb-4" />
            <CardTitle class="text-xl mb-2">{{ t('map.noGeoData') }}</CardTitle>
            <CardDescription class="text-center max-w-md">
              {{ t('map.noGeoDataDesc') }}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div v-else class="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{{ t('map.photoLocations') }}</CardTitle>
            <CardDescription>{{ t('map.photosWithLocation', { count: photos.length }) }}</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="aspect-video bg-muted rounded-lg flex items-center justify-center">
              <div class="text-center text-muted-foreground">
                <MapPin class="h-12 w-12 mx-auto mb-4" />
                <p class="text-lg font-medium mb-2">{{ t('map.mapDeveloping') }}</p>
                <p class="text-sm">{{ t('map.mapIntegrationNeeded') }}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div
            v-for="photo in photos.slice(0, 12)"
            :key="photo.id"
            class="relative aspect-square rounded-lg overflow-hidden bg-muted group cursor-pointer"
          >
            <img
              :src="photo.thumbUrl"
              :alt="photo.filename"
              class="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
            <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
              <div class="flex items-center gap-1 text-white text-xs">
                <MapPin class="h-3 w-3" />
                <span v-if="photo.lat != null && photo.lng != null">{{ photo.lat.toFixed(4) }}, {{ photo.lng.toFixed(4) }}</span>
                <span v-else>{{ t('map.unknownLocation') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
