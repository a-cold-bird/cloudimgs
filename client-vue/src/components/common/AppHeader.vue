<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Moon, Sun, UploadCloud, Github } from 'lucide-vue-next'
import UploadDialog from '@/components/upload/UploadDialog.vue'
import { setLocale } from '@/i18n'

const { t, locale } = useI18n()

const isDark = ref(false)

// Language toggle
const currentLocale = computed(() => locale.value)

function toggleLocale() {
  const newLocale = currentLocale.value === 'zh' ? 'en' : 'zh'
  setLocale(newLocale)
}

function openGithub() {
  window.open('https://github.com/icelin99/cloudimgs', '_blank')
}

function toggleDark() {
  isDark.value = !isDark.value
  if (isDark.value) {
    document.documentElement.classList.add('dark')
    localStorage.setItem('theme', 'dark')
  } else {
    document.documentElement.classList.remove('dark')
    localStorage.setItem('theme', 'light')
  }
}

onMounted(() => {
  // Sync initial state
  isDark.value = document.documentElement.classList.contains('dark')

  // Create an observer to watch for class changes on html element
  // This ensures the header button stays in sync if changed from SettingsView
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        isDark.value = document.documentElement.classList.contains('dark')
      }
    })
  })

  observer.observe(document.documentElement, {
    attributes: true
  })
})

</script>

<template>
  <header class="h-14 flex items-center justify-between px-6 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
    <div>
      <!-- Breadcrumbs can go here -->
    </div>
    <div class="flex items-center gap-1">
      <UploadDialog>
        <Button class="gap-2">
          <UploadCloud class="h-4 w-4" />
          {{ t('common.upload') }}
        </Button>
      </UploadDialog>
      <Button variant="ghost" size="icon" @click="toggleLocale()" :title="currentLocale === 'zh' ? 'Switch to English' : '切换到中文'">
        <span class="text-xs font-medium">{{ currentLocale === 'zh' ? 'EN' : '中' }}</span>
      </Button>
      <Button variant="ghost" size="icon" @click="openGithub()" title="GitHub">
        <Github class="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" @click="toggleDark()">
        <Moon v-if="isDark" class="h-5 w-5" />
        <Sun v-else class="h-5 w-5" />
      </Button>
    </div>
  </header>
</template>
