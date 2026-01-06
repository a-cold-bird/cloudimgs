<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Moon, Sun, LogOut, RefreshCw, Globe } from 'lucide-vue-next'
import { setLocale } from '@/i18n'

const { t, locale } = useI18n()
const authStore = useAuthStore()

// 暗色模式状态
const isDark = ref(false)

onMounted(() => {
  // 读取存储的主题偏好
  const stored = localStorage.getItem('theme')
  if (stored === 'dark') {
    isDark.value = true
    document.documentElement.classList.add('dark')
  } else if (stored === 'light') {
    isDark.value = false
    document.documentElement.classList.remove('dark')
  } else {
    // 跟随系统偏好
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (isDark.value) {
      document.documentElement.classList.add('dark')
    }
  }
})

function handleDarkModeChange(checked: boolean) {
  isDark.value = checked
  if (checked) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

function toggleLanguage() {
  const newLocale = locale.value === 'zh' ? 'en' : 'zh'
  setLocale(newLocale)
}

function clearCache() {
  localStorage.removeItem('cached_albums')
  localStorage.removeItem('cached_tags')
  toast.success(t('settings.cacheCleared'))
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">{{ t('settings.title') }}</h1>
      <p class="text-muted-foreground">{{ t('settings.description') }}</p>
    </div>

    <div class="grid gap-6">
      <!-- 外观设置 -->
      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.appearance') }}</CardTitle>
          <CardDescription>{{ t('settings.appearanceDesc') }}</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">{{ t('settings.darkMode') }}</p>
              <p class="text-sm text-muted-foreground">{{ t('settings.darkModeDesc') }}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              @click="handleDarkModeChange(!isDark)"
            >
              <Sun v-if="isDark" class="h-4 w-4 mr-2" />
              <Moon v-else class="h-4 w-4 mr-2" />
              {{ isDark ? t('settings.lightMode') : t('settings.darkMode') }}
            </Button>
          </div>

          <Separator />

          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <p class="text-sm font-medium">{{ t('settings.language') }}</p>
              <p class="text-sm text-muted-foreground">{{ t('settings.languageDesc') }}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              @click="toggleLanguage"
            >
              <Globe class="h-4 w-4 mr-2" />
              {{ locale === 'zh' ? t('settings.english') : t('settings.chinese') }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- 缓存设置 -->
      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.cache') }}</CardTitle>
          <CardDescription>{{ t('settings.cacheDesc') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" @click="clearCache">
            <RefreshCw class="mr-2 h-4 w-4" />
            {{ t('settings.clearCache') }}
          </Button>
        </CardContent>
      </Card>

      <!-- 账户设置 -->
      <Card>
        <CardHeader>
          <CardTitle>{{ t('settings.account') }}</CardTitle>
          <CardDescription>{{ t('settings.accountDesc') }}</CardDescription>
        </CardHeader>
        <CardContent>
          <Separator class="mb-4" />
          <Button variant="destructive" @click="authStore.logout">
            <LogOut class="mr-2 h-4 w-4" />
            {{ t('auth.logout') }}
          </Button>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
