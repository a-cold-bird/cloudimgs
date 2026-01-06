<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ImageItem } from '@/stores/gallery'
import { ImageOff } from 'lucide-vue-next'

const props = defineProps<{
  image: ImageItem
  selected?: boolean
}>()

const emit = defineEmits<{
  (e: 'click', image: ImageItem): void
  (e: 'toggle', id: string): void
}>()

const imgError = ref(false)
const imgLoaded = ref(false)

// Use thumbhash or small thumbnail
// Only request resize if the original is larger than 400px
// GIF images should not be processed to preserve animation
const thumbnailUrl = computed(() => {
  if (!props.image.url) return ''
  
  // If error occurred, use original URL as fallback
  if (imgError.value) {
    return props.image.url
  }
  
  // GIF images: use original to preserve animation
  if (props.image.mimeType === 'image/gif') {
    return props.image.url
  }
  
  // If image is already smaller than thumbnail size, use original
  if (props.image.width && props.image.width <= 400) {
    return props.image.url
  }
  
  return `${props.image.url}?w=400&q=80&fmt=webp`
})

// Normalize aspect ratio to prevent extreme values
// Clamp between 0.5 (2:1 portrait) and 2.0 (2:1 landscape)
const aspectRatio = computed(() => {
  if (props.image.width && props.image.height) {
    const ratio = props.image.width / props.image.height
    const clampedRatio = Math.max(0.5, Math.min(2.0, ratio))
    return clampedRatio
  }
  return 1
})

function handleImageError() {
  console.warn('Image load error:', props.image.url)
  imgError.value = true
}

function handleImageLoad() {
  imgLoaded.value = true
}
</script>

<template>
  <div 
    class="relative group rounded-lg overflow-hidden cursor-pointer bg-muted/50 select-none animate-in fade-in duration-500 break-inside-avoid shadow-sm hover:shadow-lg transition-all border border-transparent hover:border-primary/30"
    :class="{'ring-2 ring-primary ring-offset-4 ring-offset-background': selected}"
    :style="{ aspectRatio: aspectRatio }"
    @click="emit('click', image)"
  >
    <!-- Selection overlay -->
    <div 
        class="absolute top-3 left-3 z-20 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center scale-90 group-hover:scale-100" 
        :class="{'opacity-100 scale-100': selected}" 
        @click.stop
    >
         <div 
            class="h-6 w-6 rounded-lg border border-white/30 flex items-center justify-center transition-all shadow-lg"
            :class="selected ? 'bg-primary border-primary scale-110' : 'bg-black/30 backdrop-blur-md hover:bg-black/50'"
            @click="emit('toggle', image.id)"
         >
            <div v-show="selected" class="w-2.5 h-1.5 border-l-2 border-b-2 border-white -rotate-45 mb-1 shadow-sm"></div>
         </div>
    </div>

    <!-- Error Placeholder -->
    <div v-if="imgError && !imgLoaded" class="absolute inset-0 flex flex-col items-center justify-center bg-muted text-muted-foreground">
        <ImageOff class="h-8 w-8 opacity-50 mb-2" />
        <span class="text-xs opacity-50">加载失败</span>
    </div>

    <!-- Image -->
    <img 
      :src="thumbnailUrl" 
      :alt="image.originalName"
      loading="lazy"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;"
      class="transition-transform duration-1000 ease-out group-hover:scale-105"
      :class="{ 'opacity-0': !imgLoaded }"
      @error="handleImageError"
      @load="handleImageLoad"
    />

    <!-- Bottom info overlay -->
    <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-4 group-hover:translate-y-0">
      <p class="text-white text-[10px] font-bold tracking-wider opacity-60 uppercase mb-1">{{ image.mimeType.split('/')[1] }}</p>
      <p class="text-white text-xs font-semibold truncate drop-shadow-md">{{ image.originalName }}</p>
    </div>
  </div>
</template>
