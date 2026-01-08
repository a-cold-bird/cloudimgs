<script setup lang="ts">
import { computed } from 'vue'
import type { ImageItem } from '@/stores/gallery'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table'
import { ImageIcon, MoreHorizontal } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
    images: ImageItem[]
    selectedIds: Set<string>
}>()

const emit = defineEmits<{
    (e: 'click', image: ImageItem): void
    (e: 'toggle', id: string): void
    (e: 'toggle-all', selected: boolean): void
}>()

// 格式化文件大小
function formatSize(bytes: number) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// 格式化日期
function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString()
}

// 获取缩略图 URL
function getThumbnailUrl(image: ImageItem) {
    if (!image.url) return ''
    if (image.mimeType === 'image/gif') return image.url
    // 使用较小的缩略图
    return `${image.url}?w=100&q=80&fmt=webp`
}

const allSelected = computed(() => {
    return props.images.length > 0 && props.images.every(img => props.selectedIds.has(img.id))
})

const isIndeterminate = computed(() => {
    return props.selectedIds.size > 0 && !allSelected.value
})

function handleToggleAll(checked: boolean) {
    emit('toggle-all', checked)
}
</script>

<template>
    <div class="rounded-md border bg-card">
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead class="w-[50px]">
                        <Checkbox
                            :checked="allSelected || isIndeterminate"
                            class="translate-y-[2px]"
                            @update:checked="handleToggleAll"
                        />
                    </TableHead>
                    <TableHead class="w-[100px]">预览</TableHead>
                    <TableHead>文件名</TableHead>
                    <TableHead class="w-[100px]">格式</TableHead>
                    <TableHead class="w-[100px]">尺寸</TableHead>
                    <TableHead class="w-[100px]">大小</TableHead>
                    <TableHead class="w-[200px]">上传时间</TableHead>
                    <TableHead class="w-[150px]">标签</TableHead>
                    <TableHead class="w-[50px]"></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                <TableRow
                    v-for="image in images"
                    :key="image.id"
                    class="group cursor-pointer hover:bg-muted/50"
                    :class="{'bg-muted/30': selectedIds.has(image.id)}"
                    @click="emit('click', image)"
                >
                    <TableCell @click.stop>
                        <Checkbox
                            :checked="selectedIds.has(image.id)"
                            @update:checked="emit('toggle', image.id)"
                        />
                    </TableCell>
                    <TableCell class="py-2">
                        <div class="h-12 w-12 rounded overflow-hidden bg-muted flex items-center justify-center border">
                            <img
                                v-if="image.url"
                                :src="getThumbnailUrl(image)"
                                class="h-full w-full object-cover"
                                loading="lazy"
                            />
                            <ImageIcon v-else class="h-6 w-6 text-muted-foreground/50" />
                        </div>
                    </TableCell>
                    <TableCell>
                        <div class="flex flex-col">
                            <span class="font-medium truncate max-w-[200px]">{{ image.originalName }}</span>
                            <span class="text-xs text-muted-foreground hidden sm:inline-block">ID: {{ image.id.substring(0, 8) }}...</span>
                        </div>
                    </TableCell>
                    <TableCell>
                        <Badge variant="outline" class="font-normal uppercase text-xs">
                            {{ image.mimeType?.split('/')[1] || 'FILE' }}
                        </Badge>
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                        {{ image.width && image.height ? `${image.width}x${image.height}` : '-' }}
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                        {{ formatSize(image.size) }}
                    </TableCell>
                    <TableCell class="text-muted-foreground text-sm">
                        {{ formatDate(image.createdAt) }}
                    </TableCell>
                    <TableCell>
                        <div class="flex gap-1 flex-wrap">
                            <Badge
                                v-for="tag in image.tags.slice(0, 2)"
                                :key="tag"
                                variant="secondary"
                                class="text-[10px] px-1 h-5"
                            >
                                {{ tag }}
                            </Badge>
                            <span v-if="image.tags.length > 2" class="text-xs text-muted-foreground">+{{ image.tags.length - 2 }}</span>
                        </div>
                    </TableCell>
                    <TableCell>
                        <Button variant="ghost" size="icon" class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal class="h-4 w-4" />
                        </Button>
                    </TableCell>
                </TableRow>
            </TableBody>
        </Table>
    </div>
</template>
