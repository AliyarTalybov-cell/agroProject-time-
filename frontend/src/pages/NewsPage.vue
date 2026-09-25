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

<style scoped>
@layer legacy {
.news-page { display:flex; flex-direction:column; gap:1rem; }
.news-header { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; flex-wrap:wrap; }
.news-header--actions-only { justify-content:flex-end; }
.news-header--actions-only:empty { display:none; }
.news-loading { margin-top:0.75rem; }
.news-empty { margin:0; color:var(--text-muted); }
.news-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1.35rem 1rem; align-items:start; }
.news-card { background:transparent; border:none; border-radius:0; padding:0; display:flex; flex-direction:column; gap:0.52rem; cursor:pointer; transition:transform .18s ease; min-width:0; }
.news-card:hover { transform:translateY(-2px); }
.news-card-image { width:100%; aspect-ratio:16/10; object-fit:cover; border-radius:4px; background:#eef2ef; }
.news-card-image--empty { display:grid; place-items:center; color:var(--text-muted); font-size:.9rem; }
.news-card-title { margin:0; font-size:1rem; line-height:1.28; font-weight:600; font-family:inherit; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; text-wrap:balance; }
.news-card-date { margin:.15rem 0 0; color:var(--text-muted); font-size:.86rem; font-weight:500; font-family:inherit; }
.news-add-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 16px; border:none; border-radius:8px; background:var(--accent-green); color:#fff; font-size:.875rem; font-weight:500; font-family:inherit; cursor:pointer; transition:background .22s ease, transform .22s ease, box-shadow .22s ease; box-shadow:0 1px 2px rgba(0,0,0,.05); }
.news-add-btn:hover { background:var(--accent-green-hover); transform:translateY(-1px) scale(1.01); box-shadow:0 6px 14px rgba(61,92,64,.3); }
.news-add-btn-icon { width:18px; height:18px; flex-shrink:0; transition:transform .28s ease; transform-origin:center; }
.news-add-btn:hover .news-add-btn-icon { transform:rotate(48deg) scale(1.18); }
.news-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-color);
  min-height: 40px;
}
.news-pagination-info {
  font-size: 0.875rem;
  color: var(--text-secondary);
}
.news-pagination-right {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  flex-wrap: wrap;
}
.news-pagination-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.news-pagination-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h);
  height: var(--control-h);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.news-pagination-arrow:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: var(--text-secondary);
}
.news-pagination-arrow:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.news-pagination-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: var(--control-h);
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.news-pagination-num:hover {
  background: var(--bg-panel-hover);
}
.news-pagination-num--active {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--text-primary);
}
[data-theme='dark'] .news-pagination-num--active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.5);
}
.news-pagination-num--active:hover {
  background: rgba(76, 175, 80, 0.22);
}
@media (max-width: 1200px) {
  .news-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .news-card-title { font-size:.97rem; }
}
@media (max-width: 900px) {
  .news-header { align-items: stretch; }
  .news-add-btn { width:100%; }
}
@media (max-width: 760px) {
  .news-grid { grid-template-columns:1fr; gap:1rem; }
  .news-card-image { aspect-ratio:16/9; border-radius:8px; }
  .news-card-title { font-size:.96rem; -webkit-line-clamp:2; }
  .news-page { gap:.85rem; }
  .news-pagination {
    flex-direction: column;
    align-items: stretch;
  }
  .news-pagination-info {
    width: 100%;
    text-align: center;
  }
  .news-pagination-right {
    justify-content: center;
  }
}
}
</style>
