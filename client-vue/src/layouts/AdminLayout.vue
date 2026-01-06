<script setup lang="ts">
import { RouterView } from 'vue-router'
import AppSidebar from '@/components/common/AppSidebar.vue'
import AppHeader from '@/components/common/AppHeader.vue'
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
      <main class="flex-1 overflow-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
