<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { isSupabaseConfigured, loadNewsPostsPage, type NewsPostRow } from '@/lib/newsSupabase'
import UiLoadingBar from '@/components/UiLoadingBar.vue'

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
  <section class="news-page">
    <header class="news-header news-header--actions-only page-enter-item">
      <button v-if="isManager" type="button" class="news-add-btn" @click="openCreate">
        <svg class="news-add-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
        Добавить новость
      </button>
    </header>
    <div v-if="loading" class="news-loading"><UiLoadingBar /></div>
    <p v-else-if="error" class="news-empty">{{ error }}</p>
    <p v-else-if="!posts.length" class="news-empty">Пока нет новостей.</p>
    <div v-else class="news-grid page-enter-item">
      <article v-for="post in posts" :key="post.id" class="news-card" @click="openPost(post.id)">
        <img v-if="post.cover_image_url" :src="post.cover_image_url" :alt="post.title" class="news-card-image" loading="lazy" />
        <div v-else class="news-card-image news-card-image--empty">Без изображения</div>
        <h2 class="news-card-title">{{ post.title }}</h2>
        <p class="news-card-date">{{ formatDate(post.published_at) }}</p>
      </article>
    </div>
    <div v-if="!loading && !error && total > 0" class="news-pagination page-enter-item">
      <div class="news-pagination-info">
        Показано {{ posts.length }} из {{ total }}
      </div>
      <div class="news-pagination-right">
        <div class="news-pagination-nav">
          <button type="button" class="news-pagination-arrow" :disabled="page <= 1" @click="setPage(page - 1)">‹</button>
          <button
            v-for="n in totalPages"
            :key="`news-page-${n}`"
            type="button"
            class="news-pagination-num"
            :class="{ 'news-pagination-num--active': n === page }"
            @click="setPage(n)"
          >
            {{ n }}
          </button>
          <button type="button" class="news-pagination-arrow" :disabled="page >= totalPages" @click="setPage(page + 1)">›</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
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
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
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
  height: 36px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
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
</style>
