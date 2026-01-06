<script setup lang="ts">
import { ref, onMounted } from 'vue'
import api from '@/services/api'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Plus, Tag, Hash, Loader2 } from 'lucide-vue-next'

interface TagItem {
  id: string
  name: string
  color?: string
  fileCount?: number
}

const tags = ref<TagItem[]>([])
const isLoading = ref(true)
const showCreateDialog = ref(false)
const newTagName = ref('')
const newTagColor = ref('#3b82f6')
const isCreating = ref(false)

const colors = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', 
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
]

async function fetchTags() {
  isLoading.value = true
  try {
    const response = await api.get('/tags')
    tags.value = response.data.data || response.data || []
  } catch (error) {
    console.error('Failed to fetch tags:', error)
    toast.error('加载标签失败')
  } finally {
    isLoading.value = false
  }
}

async function createTag() {
  if (!newTagName.value.trim()) return
  
  isCreating.value = true
  try {
    await api.post('/tags', {
      name: newTagName.value.trim(),
      color: newTagColor.value
    })
    toast.success('标签创建成功')
    newTagName.value = ''
    showCreateDialog.value = false
    await fetchTags()
  } catch (error) {
    console.error('Failed to create tag:', error)
    toast.error('创建标签失败')
  } finally {
    isCreating.value = false
  }
}

onMounted(() => {
  fetchTags()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">标签管理</h1>
        <p class="text-muted-foreground">管理您的图片标签</p>
      </div>
      <Dialog v-model:open="showCreateDialog">
        <DialogTrigger as-child>
          <Button>
            <Plus class="mr-2 h-4 w-4" />
            创建标签
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新标签</DialogTitle>
            <DialogDescription>
              为您的图片添加一个新的分类标签
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label for="name">标签名称</Label>
              <Input
                id="name"
                v-model="newTagName"
                placeholder="输入标签名称"
              />
            </div>
            <div class="space-y-2">
              <Label>标签颜色</Label>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="color in colors"
                  :key="color"
                  class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                  :class="newTagColor === color ? 'border-foreground scale-110' : 'border-transparent'"
                  :style="{ backgroundColor: color }"
                  @click="newTagColor = color"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="showCreateDialog = false">取消</Button>
            <Button @click="createTag" :disabled="isCreating || !newTagName.trim()">
              <Loader2 v-if="isCreating" class="mr-2 h-4 w-4 animate-spin" />
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <div v-else-if="tags.length === 0" class="flex flex-col items-center justify-center py-12">
      <Hash class="h-12 w-12 text-muted-foreground mb-4" />
      <p class="text-muted-foreground mb-4">暂无标签</p>
      <Button @click="showCreateDialog = true">
        <Plus class="mr-2 h-4 w-4" />
        创建第一个标签
      </Button>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      <Card v-for="tag in tags" :key="tag.id" class="hover:shadow-md transition-shadow cursor-pointer">
        <CardHeader class="pb-2">
          <CardTitle class="text-lg flex items-center gap-2">
            <Tag class="h-4 w-4" :style="{ color: tag.color || '#3b82f6' }" />
            {{ tag.name }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="secondary">
            {{ tag.fileCount || 0 }} 张图片
          </Badge>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
