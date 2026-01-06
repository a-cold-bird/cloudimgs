<script setup lang="ts">
import { ref } from 'vue'
import { UploadCloud } from 'lucide-vue-next'
import { useUploadStore } from '@/stores/upload'
import { cn } from '@/lib/utils'

const store = useUploadStore()
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

function onDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  if (e.dataTransfer?.files) {
    store.addToQueue(e.dataTransfer.files)
  }
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) {
    store.addToQueue(input.files)
    input.value = '' // reset
  }
}
</script>

<template>
  <div
    :class="cn(
      'border-2 border-dashed rounded-lg p-12 text-center hover:bg-accent/50 transition-colors cursor-pointer',
      isDragging ? 'border-primary bg-accent' : 'border-muted-foreground/25'
    )"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @click="fileInput?.click()"
  >
    <input
      ref="fileInput"
      type="file"
      multiple
      class="hidden"
      accept="image/*"
      @change="onFileSelect"
    />
    <div class="flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <UploadCloud class="h-10 w-10" />
      <p class="text-sm font-medium">Drag & drop images here, or click to select</p>
    </div>
  </div>
</template>
