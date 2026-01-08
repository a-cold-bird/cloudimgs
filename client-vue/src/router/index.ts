import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        // ==================== 公开页面 ====================
        {
            path: '/',
            name: 'public-home',
            component: () => import('@/views/PublicHomeView.vue'),
            meta: { requiresAuth: false }
        },

        // ==================== 管理后台 ====================
        {
            path: '/admin',
            component: () => import('@/layouts/AdminLayout.vue'),
            meta: { requiresAuth: true },
            children: [
                {
                    path: '',
                    name: 'admin-home',
                    component: () => import('@/views/HomeView.vue'),
                    meta: { fullWidth: true }
                },
                {
                    path: 'albums',
                    name: 'admin-albums',
                    component: () => import('@/views/AlbumsView.vue')
                },
                {
                    path: 'albums/:slug',
                    name: 'admin-album-detail',
                    component: () => import('@/views/AlbumDetailView.vue'),
                    meta: { fullWidth: true }
                },
                {
                    path: 'tags',
                    name: 'admin-tags',
                    component: () => import('@/views/TagsView.vue')
                },
                {
                    path: 'map',
                    name: 'admin-map',
                    component: () => import('@/views/MapView.vue')
                },
                {
                    path: 'settings',
                    name: 'admin-settings',
                    component: () => import('@/views/SettingsView.vue')
                }
            ]
        },

        // ==================== 登录页面 ====================
        {
            path: '/auth',
            component: () => import('@/layouts/AuthLayout.vue'),
            children: [
                {
                    path: 'login',
                    name: 'login',
                    component: () => import('@/views/LoginView.vue')
                }
            ]
        },
        {
            path: '/login',
            redirect: '/auth/login'
        },

        // ==================== 兼容旧路由 ====================
        { path: '/albums', redirect: '/admin/albums' },
        { path: '/albums/:slug', redirect: to => `/admin/albums/${to.params.slug}` },
        { path: '/tags', redirect: '/admin/tags' },
        { path: '/map', redirect: '/admin/map' },
        { path: '/settings', redirect: '/admin/settings' },
    ]
})

router.beforeEach(async (to, _from, next) => {
    const authStore = useAuthStore()

    // 确保 auth store 已初始化（验证存储的 token）
    if (!authStore.isInitialized) {
        await authStore.initialize()
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
        next({ name: 'login', query: { redirect: to.fullPath } })
    } else if (to.name === 'login' && authStore.isAuthenticated) {
        // 登录后跳转到管理后台
        const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/admin'
        next({ path: redirect })
    } else {
        next()
    }
})

export default router

