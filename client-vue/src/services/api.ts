import axios from 'axios'

// API 超时配置（毫秒）
const API_TIMEOUT = 30000 // 30秒，普通请求
const UPLOAD_TIMEOUT = 600000 // 10分钟，上传请求

const api = axios.create({
    baseURL: '/api',
    timeout: API_TIMEOUT,
})

// 为上传请求提供更长的超时时间
export function getUploadConfig(additionalConfig = {}) {
    return {
        timeout: UPLOAD_TIMEOUT,
        ...additionalConfig
    }
}

// Request interceptor for API calls
api.interceptors.request.use(
    (config) => {
        const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token')
        if (token) {
            config.headers['x-access-password'] = token
        }
        return config
    },
    (error) => {
        return Promise.reject(error)
    }
)

// Response interceptor for API calls
api.interceptors.response.use(
    (response) => {
        return response
    },
    async (error) => {
        if (error.response && error.response.status === 401) {
            // Clear token and redirect to login if unauthorized
            sessionStorage.removeItem('auth_token')
            localStorage.removeItem('auth_token')
            window.location.href = '/login'
        }
        return Promise.reject(error)
    }
)

export default api
