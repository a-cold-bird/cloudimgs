import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AxiosProgressEvent } from 'axios'
import api, { getUploadConfig } from '@/services/api'
import { toast } from 'vue-sonner'

// 常量定义
const ROOT_ALBUM_ID = '' // 根目录使用空字符串表示

export interface UploadFileItem {
    file: File
    progress: number
    status: 'pending' | 'uploading' | 'success' | 'error' | 'cancelled'
    error?: string
    albumId?: string
}

export const useUploadStore = defineStore('upload', () => {
    const queue = ref<UploadFileItem[]>([])
    const isUploading = ref(false)
    const selectedAlbumId = ref<string>(ROOT_ALBUM_ID)

    // AbortController for cancelling current upload
    let abortController: AbortController | null = null
    // Flag to stop queue processing
    const isCancelled = ref(false)

    function addToQueue(files: FileList | File[], albumId?: string) {
        const newItems: UploadFileItem[] = Array.from(files).map(f => ({
            file: f,
            progress: 0,
            status: 'pending',
            albumId: albumId
        }))
        queue.value.push(...newItems)
        processQueue()
    }

    async function processQueue() {
        // Check if cancelled
        if (isCancelled.value) {
            isCancelled.value = false
            isUploading.value = false
            return
        }

        if (isUploading.value) return

        // Find next pending
        const index = queue.value.findIndex(i => i.status === 'pending')
        if (index === -1) {
            // All done
            return
        }

        const item = queue.value[index]
        if (!item) return

        isUploading.value = true
        item.status = 'uploading'

        // Create new AbortController for this upload
        abortController = new AbortController()

        try {
            const formData = new FormData()
            formData.append('file', item.file)

            // Determine album ID: specific item ID > global selected ID
            const targetAlbumId = item.albumId || selectedAlbumId.value || undefined

            if (targetAlbumId) {
                formData.append('albumId', targetAlbumId)
            }

            await api.post('/files/upload', formData, getUploadConfig({
                headers: {
                    'Content-Type': 'multipart/form-data'
                },
                signal: abortController.signal,
                onUploadProgress: (progressEvent: AxiosProgressEvent) => {
                    if (progressEvent.total) {
                        item.progress = Math.round((progressEvent.loaded * 100) / progressEvent.total)
                    }
                }
            }))

            item.status = 'success'
            item.progress = 100
            toast.success(`已上传 ${item.file.name}`)
        } catch (error: any) {
            // Check if it was cancelled
            if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
                item.status = 'cancelled'
                item.error = '已取消'
            } else {
                console.error(error)
                item.status = 'error'
                item.error = '上传失败'
                toast.error(`上传失败: ${item.file.name}`)
            }
        } finally {
            abortController = null
            isUploading.value = false
            processQueue() // Process next
        }
    }

    /**
     * Cancel a specific item in the queue
     */
    function cancelItem(index: number) {
        const item = queue.value[index]
        if (!item) return

        if (item.status === 'uploading') {
            // Cancel the current upload request
            if (abortController) {
                abortController.abort()
            }
        } else if (item.status === 'pending') {
            // Mark as cancelled
            item.status = 'cancelled'
        }
    }

    /**
     * Remove a specific item from the queue
     */
    function removeItem(index: number) {
        const item = queue.value[index]
        if (!item) return

        // If uploading, cancel first
        if (item.status === 'uploading') {
            cancelItem(index)
        }

        queue.value.splice(index, 1)
    }

    /**
     * Cancel all pending and uploading items
     */
    function cancelAll() {
        // Stop queue processing
        isCancelled.value = true

        // Cancel current upload if any
        if (abortController) {
            abortController.abort()
        }

        // Mark all pending items as cancelled
        for (const item of queue.value) {
            if (item.status === 'pending' || item.status === 'uploading') {
                item.status = 'cancelled'
            }
        }

        isUploading.value = false
    }

    /**
     * Clear completed and cancelled items
     */
    function clearCompleted() {
        queue.value = queue.value.filter(i => i.status !== 'success' && i.status !== 'cancelled')
    }

    /**
     * Clear all items from the queue
     */
    function clearAll() {
        cancelAll()
        queue.value = []
    }

    return {
        queue,
        isUploading,
        addToQueue,
        clearCompleted,
        selectedAlbumId,
        cancelItem,
        removeItem,
        cancelAll,
        clearAll
    }
})
