import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'

// 分页配置常量
const PAGE_SIZE = 50

export interface ImageItem {
    id: string
    originalName: string
    size: number
    mimeType: string
    width?: number
    height?: number
    thumbhash?: string
    tags: string[]
    albumId?: string
    createdAt: string
    url: string
}

export const useGalleryStore = defineStore('gallery', () => {
    const images = ref<ImageItem[]>([])
    const isLoading = ref(false)
    const page = ref(1)
    const hasMore = ref(true)
    const searchQuery = ref('')

    async function fetchImages(reset = false, albumId?: string) {
        if (reset) {
            page.value = 1
            images.value = []
            hasMore.value = true
        }

        if (isLoading.value || !hasMore.value) return

        isLoading.value = true
        try {
            const res = await api.get('/files', {
                params: {
                    page: page.value,
                    limit: PAGE_SIZE,
                    albumId,
                    q: searchQuery.value || undefined
                }
            })

            const items = Array.isArray(res.data) ? res.data : (res.data.data || res.data.files || [])

            if (items.length < PAGE_SIZE) {
                hasMore.value = false
            }

            if (reset) {
                images.value = items
            } else {
                images.value.push(...items)
            }

            if (items.length > 0) {
                page.value++
            }
        } catch (error) {
            console.error('Failed to fetch images', error)
        } finally {
            isLoading.value = false
        }
    }

    return { images, isLoading, hasMore, searchQuery, fetchImages }
})
