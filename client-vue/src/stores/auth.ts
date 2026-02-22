import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '@/services/api'

export const useAuthStore = defineStore('auth', () => {
    const isAuthenticated = ref(false)
    const isLoading = ref(false)
    const isInitialized = ref(false)
    const requiresPassword = ref(true) // 默认需要密码

    function getStoredToken(): string | null {
        return sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token')
    }

    function saveToken(token: string) {
        sessionStorage.setItem('auth_token', token)
        // 兼容迁移：清理旧的持久化明文 token
        localStorage.removeItem('auth_token')
    }

    function clearToken() {
        sessionStorage.removeItem('auth_token')
        localStorage.removeItem('auth_token')
    }

    // 初始化时检查后端认证状态
    async function initialize() {
        if (isInitialized.value) return

        try {
            // 1. 先检查后端是否需要密码认证
            const statusRes = await api.get('/auth/status')
            requiresPassword.value = statusRes.data.requiresPassword

            // 2. 如果不需要密码，直接标记为已认证
            if (!requiresPassword.value) {
                isAuthenticated.value = true
                isInitialized.value = true
                return
            }

            // 3. 需要密码时，验证存储的 token
            const storedToken = getStoredToken()
            if (storedToken) {
                const valid = await verifyToken(storedToken)
                isAuthenticated.value = valid
                if (!valid) {
                    clearToken()
                }
            }
        } catch (error) {
            console.error('Failed to initialize auth:', error)
            // 出错时保守处理，需要登录
            isAuthenticated.value = false
        }

        isInitialized.value = true
    }

    // 验证 token 是否有效
    async function verifyToken(token: string): Promise<boolean> {
        try {
            const res = await api.post('/auth/verify', { password: token })
            return res.data.success === true
        } catch {
            return false
        }
    }

    async function login(password: string): Promise<boolean> {
        isLoading.value = true
        try {
            // 如果后端不需要密码，直接成功
            if (!requiresPassword.value) {
                isAuthenticated.value = true
                return true
            }

            // 验证密码
            const res = await api.post('/auth/verify', { password })
            if (res.data.success) {
                saveToken(password)
                isAuthenticated.value = true
                return true
            }
            return false
        } catch (error) {
            console.error('Login failed', error)
            return false
        } finally {
            isLoading.value = false
        }
    }

    function logout() {
        api.post('/auth/logout').catch(() => {
            // ignore network errors during logout cleanup
        })
        clearToken()
        isAuthenticated.value = false
        isInitialized.value = false // 重置初始化状态，下次访问需要重新检查
        window.location.href = '/' // 跳转到公开首页
    }

    return {
        isAuthenticated,
        isLoading,
        isInitialized,
        requiresPassword,
        initialize,
        login,
        logout
    }
})
