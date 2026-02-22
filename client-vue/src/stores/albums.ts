import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'
import { toast } from 'vue-sonner'

export interface Album {
    id: string
    name: string
    slug: string
    isPublic: boolean
    parentId?: string
    children?: Album[]
    fileCount?: number
    coverFileId?: string
}

export const useAlbumStore = defineStore('album', () => {
    const albums = ref<Album[]>([])
    const isLoading = ref(false)
    const currentAlbum = ref<Album | null>(null)

    function encodeAlbumIdForApi(id: string): string {
        return id
            .split('/')
            .map(part => encodeURIComponent(part))
            .join('/')
    }

    function decodeAlbumSlug(slug: string): string {
        try {
            return decodeURIComponent(slug)
        } catch {
            // 兼容旧版 slug（将 '-' 作为路径分隔）
            return slug.replace(/-/g, '/')
        }
    }

    async function fetchAlbums(parentId?: string) {
        isLoading.value = true
        try {
            const res = await api.get('/albums', {
                params: {
                    flat: false,
                    parentId
                }
            })
            // API return format: { success: true, data: [...] } or just [...]
            // Usually API.md implies directly data or wrapped. standard is wrapped.
            // Based on previous step check: {"success":true,"data":{...}}
            const data = res.data.data || res.data
            albums.value = Array.isArray(data) ? data : []
        } catch (error) {
            console.error('Failed to fetch albums', error)
            toast.error('获取相册列表失败')
        } finally {
            isLoading.value = false
        }
    }

    async function createAlbum(name: string, parentId?: string) {
        try {
            await api.post('/albums', { name, parentId, isPublic: false })
            toast.success('相册创建成功')
            await fetchAlbums(parentId)
            return true
        } catch (error) {
            console.error(error)
            toast.error('创建失败')
            return false
        }
    }

    async function deleteAlbum(id: string) {
        try {
            await api.delete(`/albums/${encodeAlbumIdForApi(id)}`)
            toast.success('相册已删除')
            // Refresh logic needed, for now just fetch root
            await fetchAlbums()
        } catch (error) {
            console.error(error)
            toast.error('删除失败')
        }
    }

    async function updateAlbum(id: string, updates: Partial<Album>) {
        try {
            await api.patch(`/albums/${encodeAlbumIdForApi(id)}`, updates)
            toast.success('更新成功')
            // Update local state if current album is matched
            if (currentAlbum.value && currentAlbum.value.id === id) {
                currentAlbum.value = { ...currentAlbum.value, ...updates }
            }
            // Also update list if loaded
            const idx = albums.value.findIndex(a => a.id === id)
            if (idx !== -1) {
                albums.value[idx] = { ...albums.value[idx], ...updates } as Album
            }
            return true
        } catch (error) {
            console.error(error)
            toast.error('更新失败')
            return false
        }
    }

    async function getAlbumBySlug(slug: string): Promise<Album | null> {
        const decodedId = decodeAlbumSlug(slug)
        try {
            const detailRes = await api.get(`/albums/${encodeAlbumIdForApi(decodedId)}`)
            const detail = detailRes.data.data
            currentAlbum.value = detail
            return detail
        } catch {
            // 兼容旧版：如果直接按ID查失败，回退到 flat 列表按 slug 查找
        }

        // Fallback: resolve by slug from flattened list
        try {
            const res = await api.get('/albums', { params: { flat: true } })
            const data = res.data.data || res.data
            const all = Array.isArray(data) ? data : []
            const found = all.find((a: Album) => a.slug === slug)

            if (found) {
                // Now fetch fresh detail with fileCount
                try {
                    const detailRes = await api.get(`/albums/${encodeAlbumIdForApi(found.id)}`)
                    const detail = detailRes.data.data
                    currentAlbum.value = detail
                    return detail
                } catch (e) {
                    // Fallback to basic info if detail fetch fails
                    currentAlbum.value = found
                    return found
                }
            }
        } catch (e) {
            console.error(e)
        }
        return null
    }

    return {
        albums,
        isLoading,
        currentAlbum,
        fetchAlbums,
        createAlbum,
        deleteAlbum,
        updateAlbum,
        getAlbumBySlug
    }
})
