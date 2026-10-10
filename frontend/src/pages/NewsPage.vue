<script setup lang="ts">
import { CircleAlertIcon, ImageIcon, NewspaperIcon, PlusIcon } from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert'
import { AspectRatio } from '@/components/ui/shadcn/aspect-ratio'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/shadcn/card'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/shadcn/empty'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import UiPagination from '@/components/ui/UiPagination.vue'
import { Button } from '@/components/ui/shadcn/button'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured, loadNewsPostsPage, type NewsPostRow } from '@/lib/newsSupabase'

const auth = useAuth()
const router = useRouter()
const isManager = computed(() => auth.userRole.value === 'manager')
const loading = ref(false)
const error = ref<string | null>(null)
const posts = ref<NewsPostRow[]>([])
const page = ref(1)
const pageSize = 9
const total = ref(0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

function formatDate(dateIso: string): string {
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.')
}

async function loadData() {
  if (!isSupabaseConfigured()) {
    posts.value = []
    total.value = 0
    return
  }
  loading.value = true
  error.value = null
  try {
    const result = await loadNewsPostsPage(page.value, pageSize)
    posts.value = result.items
    total.value = result.total
    if (page.value > totalPages.value) {
      page.value = totalPages.value
      const fallback = await loadNewsPostsPage(page.value, pageSize)
      posts.value = fallback.items
      total.value = fallback.total
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить новости'
  } finally {
    loading.value = false
  }
}

function openPost(id: string) {
  void router.push({ name: 'news-details', params: { id } })
}
function openCreate() {
  void router.push({ name: 'news-new' })
}
async function setPage(next: number) {
  const safe = Math.max(1, Math.min(next, totalPages.value))
  if (safe === page.value) return
  page.value = safe
  await loadData()
}
onMounted(() => void loadData())
</script>

<template>
  <section class="grid gap-6">
    <header v-if="isManager" class="flex justify-end">
      <Button @click="openCreate">
        <PlusIcon />
        Добавить новость
      </Button>
    </header>
    <div v-if="loading" class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="i in 6" :key="i" class="grid gap-3">
        <Skeleton class="aspect-video w-full rounded-xl" />
        <Skeleton class="h-4 w-4/5" />
        <Skeleton class="h-3 w-1/3" />
      </div>
    </div>
    <Alert v-else-if="error" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>Не удалось загрузить новости</AlertTitle>
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <Empty v-else-if="!posts.length" class="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><NewspaperIcon /></EmptyMedia>
        <EmptyTitle>Пока нет новостей</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <div v-else class="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      <Card
        v-for="post in posts"
        :key="post.id"
        class="group cursor-pointer gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md"
        role="link"
        tabindex="0"
        @click="openPost(post.id)"
        @keydown.enter="openPost(post.id)"
      >
        <AspectRatio :ratio="16 / 9" class="bg-muted">
          <img
            v-if="post.cover_image_url"
            :src="post.cover_image_url"
            :alt="post.title"
            class="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
          <div v-else class="text-muted-foreground flex size-full items-center justify-center text-sm">
            <ImageIcon class="size-6 opacity-50" />
          </div>
        </AspectRatio>
        <CardHeader class="gap-1.5 p-4">
          <CardTitle class="line-clamp-2 leading-snug">{{ post.title }}</CardTitle>
          <CardDescription>{{ formatDate(post.published_at) }}</CardDescription>
        </CardHeader>
      </Card>
    </div>
    <UiPagination v-if="!loading && !error && total > 0" :page="page" :page-size="pageSize" :total="total" hide-size @update:page="setPage" />
  </section>
</template>

