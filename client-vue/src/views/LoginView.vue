<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Loader2, ShieldCheck, ArrowLeft } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

const password = ref('')
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()
const isChecking = ref(true)

// 获取跳转目标
const redirectTarget = () => {
  const redirect = route.query.redirect
  return typeof redirect === 'string' ? redirect : '/admin'
}

onMounted(async () => {
  // 初始化认证状态
  await authStore.initialize()
  isChecking.value = false
  
  // 如果不需要密码或已登录，直接跳转
  if (!authStore.requiresPassword || authStore.isAuthenticated) {
    router.push(redirectTarget())
  }
})

async function handleLogin() {
  if (!password.value && authStore.requiresPassword) return
  
  const success = await authStore.login(password.value)
  if (success) {
    toast.success('登录成功')
    router.push(redirectTarget())
  } else {
    toast.error('密码错误')
  }
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <Card class="w-[350px]">
    <CardHeader>
      <div class="flex items-center justify-between">
        <CardTitle>管理后台登录</CardTitle>
        <Button variant="ghost" size="icon" @click="goBack" title="返回首页">
          <ArrowLeft class="h-4 w-4" />
        </Button>
      </div>
      <CardDescription>输入密码以访问 CloudImgs 管理后台</CardDescription>
    </CardHeader>
    <CardContent>
      <!-- 检查状态 -->
      <div v-if="isChecking" class="flex items-center justify-center py-4">
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
        <span class="ml-2 text-muted-foreground">正在检查认证状态...</span>
      </div>
      
      <!-- 不需要密码的提示 -->
      <div v-else-if="!authStore.requiresPassword" class="flex flex-col items-center py-4">
        <ShieldCheck class="h-12 w-12 text-green-500 mb-2" />
        <p class="text-sm text-muted-foreground">服务器未启用密码保护</p>
        <p class="text-xs text-muted-foreground">正在自动跳转...</p>
      </div>
      
      <!-- 密码表单 -->
      <form v-else @submit.prevent="handleLogin" class="space-y-4">
        <div class="space-y-2">
          <Input 
            v-model="password" 
            type="password" 
            placeholder="请输入访问密码" 
            autofocus
          />
        </div>
      </form>
    </CardContent>
    <CardFooter v-if="!isChecking && authStore.requiresPassword" class="flex-col gap-2">
      <Button class="w-full" @click="handleLogin" :disabled="authStore.isLoading || !password">
        <Loader2 v-if="authStore.isLoading" class="mr-2 h-4 w-4 animate-spin" />
        登录管理后台
      </Button>
      <Button variant="ghost" class="w-full" @click="goBack">
        返回首页
      </Button>
    </CardFooter>
  </Card>
</template>


