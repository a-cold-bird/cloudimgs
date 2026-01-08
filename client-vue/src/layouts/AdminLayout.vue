<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from '@/components/common/AppSidebar.vue'
import AppHeader from '@/components/common/AppHeader.vue'

const route = useRoute()
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background text-foreground">
    <!-- Desktop Sidebar -->
    <aside class="hidden md:block">
      <AppSidebar />
    </aside>

    <!-- Main Content -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <AppHeader />
      <main
        class="flex-1 overflow-auto"
        :class="{ 'p-6': !route.meta.fullWidth }"
      >
        <RouterView />
      </main>
    </div>
  </div>
</template>
