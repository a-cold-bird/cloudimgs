<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Home, Image, Map as MapIcon, Tag, Settings, LogOut, Globe } from 'lucide-vue-next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const links = computed(() => [
  { name: t('nav.dashboard'), path: '/admin', icon: Home, exact: true },
  { name: t('nav.albumManagement'), path: '/admin/albums', icon: Image, exact: false },
  { name: t('nav.tagManagement'), path: '/admin/tags', icon: Tag, exact: false },
  { name: t('nav.mapMode'), path: '/admin/map', icon: MapIcon, exact: false },
  { name: t('nav.systemSettings'), path: '/admin/settings', icon: Settings, exact: false },
])

// 改进的路由匹配逻辑，支持子路由高亮
function isActive(link: { path: string; exact: boolean }): boolean {
  if (link.exact) {
    return route.path === link.path
  }
  return route.path === link.path || route.path.startsWith(link.path + '/')
}
</script>

<template>
  <div class="h-full flex flex-col border-r bg-background w-64">
    <div class="h-14 flex items-center justify-between px-4 border-b">
      <span class="font-bold text-lg">CloudImgs</span>
      <Button variant="ghost" size="icon" @click="router.push('/')" :title="t('nav.backToHome')">
        <Globe class="h-4 w-4" />
      </Button>
    </div>

    <nav class="flex-1 p-4 space-y-2">
      <Button
        v-for="link in links"
        :key="link.path"
        variant="ghost"
        class="w-full justify-start"
        :class="cn(isActive(link) && 'bg-accent text-accent-foreground')"
        @click="router.push(link.path)"
      >
        <component :is="link.icon" class="mr-2 h-4 w-4" />
        {{ link.name }}
      </Button>
    </nav>

    <div class="p-4 border-t">
      <Button variant="ghost" class="w-full justify-start text-red-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950" @click="authStore.logout">
        <LogOut class="mr-2 h-4 w-4" />
        {{ t('auth.logout') }}
      </Button>
    </div>
  </div>
</template>
