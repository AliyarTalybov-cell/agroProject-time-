<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { deleteNewsPost, getNewsPostById, isSupabaseConfigured, type NewsPostRow } from '@/lib/newsSupabase'
import { normalizeNewsContentToHtml } from '@/lib/newsContent'
import UiLoadingBar from '@/components/UiLoadingBar.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const post = ref<NewsPostRow | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const galleryStartIndex = ref(0)
const GALLERY_VISIBLE_COUNT = 4
const galleryShiftClass = ref('')
let galleryAnimTimer: ReturnType<typeof setTimeout> | null = null

const postId = computed(() => String(route.params.id || ''))

function formatDate(dateIso: string): string {
  const d = new Date(dateIso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.')
}

const renderedBodyHtml = computed(() => normalizeNewsContentToHtml(post.value?.content || ''))

const galleryImages = computed(() => post.value?.gallery_urls ?? [])
const hasGalleryPager = computed(() => galleryImages.value.length > GALLERY_VISIBLE_COUNT)
const lightboxIndex = ref<number | null>(null)
const galleryVisibleImages = computed(() => {
  const images = galleryImages.value
  if (!images.length) return []
  if (!hasGalleryPager.value) return images
  return Array.from({ length: GALLERY_VISIBLE_COUNT }, (_, i) => {
    const idx = (galleryStartIndex.value + i) % images.length
    return images[idx]
  })
})

function prevGalleryPage() {
  const len = galleryImages.value.length
  if (!len || !hasGalleryPager.value) return
  galleryShiftClass.value = 'is-shifting-right'
  galleryStartIndex.value = (galleryStartIndex.value - 1 + len) % len
  if (galleryAnimTimer) clearTimeout(galleryAnimTimer)
  galleryAnimTimer = setTimeout(() => {
    galleryShiftClass.value = ''
    galleryAnimTimer = null
  }, 260)
}

function nextGalleryPage() {
  const len = galleryImages.value.length
  if (!len || !hasGalleryPager.value) return
  galleryShiftClass.value = 'is-shifting-left'
  galleryStartIndex.value = (galleryStartIndex.value + 1) % len
  if (galleryAnimTimer) clearTimeout(galleryAnimTimer)
  galleryAnimTimer = setTimeout(() => {
    galleryShiftClass.value = ''
    galleryAnimTimer = null
  }, 260)
}

const lightboxImage = computed(() => {
  if (lightboxIndex.value == null) return null
  return galleryImages.value[lightboxIndex.value] ?? null
})

function openLightboxByLocalIndex(localIndex: number) {
  const len = galleryImages.value.length
  if (!len) return
  const globalIndex = hasGalleryPager.value
    ? (galleryStartIndex.value + localIndex) % len
    : localIndex
  if (!galleryImages.value[globalIndex]) return
  lightboxIndex.value = globalIndex
}

function closeLightbox() {
  lightboxIndex.value = null
}

function lightboxPrev() {
  if (lightboxIndex.value == null || !galleryImages.value.length) return
  lightboxIndex.value = (lightboxIndex.value - 1 + galleryImages.value.length) % galleryImages.value.length
}

function lightboxNext() {
  if (lightboxIndex.value == null || !galleryImages.value.length) return
  lightboxIndex.value = (lightboxIndex.value + 1) % galleryImages.value.length
}

async function loadData() {
  if (!isSupabaseConfigured()) return
  loading.value = true
  error.value = null
  try {
    post.value = await getNewsPostById(postId.value)
    galleryStartIndex.value = 0
    lightboxIndex.value = null
    if (!post.value) error.value = 'Новость не найдена'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить новость'
  } finally {
    loading.value = false
  }
}

function goBack() {
  void router.push({ name: 'news' })
}
function openEdit() {
  void router.push({ name: 'news-edit', params: { id: postId.value } })
}
async function removePost() {
  if (!isSupabaseConfigured()) return
  if (!confirm('Удалить эту новость?')) return
  await deleteNewsPost(postId.value)
  goBack()
}

onMounted(() => void loadData())
</script>

<template>
  <section class="news-details">
    <div class="news-details-top">
      <button type="button" class="news-back-btn" @click="goBack" aria-label="Назад к новостям">
        <svg class="news-back-btn-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        Назад к новостям
      </button>
      <div v-if="isManager && post" class="news-details-actions">
        <button type="button" class="news-icon-btn" aria-label="Редактировать новость" title="Редактировать" @click="openEdit">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button type="button" class="news-icon-btn news-icon-btn--danger" aria-label="Удалить новость" title="Удалить" @click="removePost">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>

    <div v-if="loading"><UiLoadingBar /></div>
    <p v-else-if="error" class="news-error">{{ error }}</p>
    <article v-else-if="post" class="news-article page-enter-item">
      <h1 class="news-title">{{ post.title }}</h1>
      <p class="news-date">{{ formatDate(post.published_at) }}</p>
      <div v-if="post.cover_image_url" class="news-cover-wrap">
        <img :src="post.cover_image_url" :alt="post.title" class="news-cover" />
        <div v-if="post.excerpt" class="news-cover-overlay" :class="`news-cover-overlay--${post.cover_excerpt_position || 'left-bottom'}`">
          <p class="news-cover-caption">{{ post.excerpt }}</p>
        </div>
      </div>
      <div class="news-body news-rich-content" v-html="renderedBodyHtml" />
      <div v-if="galleryImages.length" class="news-gallery-wrap">
        <button
          v-if="hasGalleryPager"
          type="button"
          class="news-gallery-arrow news-gallery-arrow--prev"
          aria-label="Предыдущее фото"
          @click="prevGalleryPage"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="news-gallery" :class="galleryShiftClass">
          <button
            v-for="(img, idx) in galleryVisibleImages"
            :key="`${galleryStartIndex}-${idx}`"
            type="button"
            class="news-gallery-item-btn"
            :aria-label="`Открыть фото ${idx + 1}`"
            @click="openLightboxByLocalIndex(idx)"
          >
            <img :src="img" :alt="`Фото ${idx + 1}`" class="news-gallery-img" loading="lazy" />
          </button>
        </div>
        <button
          v-if="hasGalleryPager"
          type="button"
          class="news-gallery-arrow news-gallery-arrow--next"
          aria-label="Следующее фото"
          @click="nextGalleryPage"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </article>
    <teleport to="body">
      <div v-if="lightboxImage" class="news-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фото" @click.self="closeLightbox">
        <button type="button" class="news-lightbox-close" aria-label="Закрыть" @click="closeLightbox">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>
        </button>
        <button type="button" class="news-lightbox-nav news-lightbox-nav--prev" aria-label="Предыдущее фото" @click="lightboxPrev">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <img :src="lightboxImage" alt="Фото новости" class="news-lightbox-image" />
        <button type="button" class="news-lightbox-nav news-lightbox-nav--next" aria-label="Следующее фото" @click="lightboxNext">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
.news-details { display:flex; flex-direction:column; gap:1rem; min-width:0; }
.news-details-top { display:flex; justify-content:space-between; gap:.75rem; align-items:center; flex-wrap:wrap; }
.news-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.18s ease;
}
.news-back-btn-icon {
  transition: transform 0.22s ease;
}
.news-back-btn:hover {
  color: var(--text-primary);
}
.news-back-btn:hover .news-back-btn-icon {
  transform: translateX(-2px);
}
.news-details-actions { display:flex; gap:.5rem; }
.news-icon-btn { width:38px; height:38px; border-radius:10px; border:1px solid var(--line); background:#fff; color:#344054; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; transition:all .18s ease; }
.news-icon-btn:hover { transform:translateY(-1px) scale(1.04); border-color:rgba(61,92,64,.38); color:var(--agro); }
.news-icon-btn--danger { color:#b42318; border-color:rgba(180,35,24,.35); }
.news-icon-btn--danger:hover { border-color:rgba(180,35,24,.45); color:#b42318; }
.news-error { margin:0; color:#b42318; }
.news-article { width:100%; background:#fff; border:1px solid var(--line); border-radius:22px; padding:1.1rem; display:flex; flex-direction:column; gap:1rem; min-width:0; }
.news-title { margin:0; font-size:2.1rem; line-height:1.15; text-wrap:balance; overflow-wrap:anywhere; }
.news-date { margin:0; color:var(--text-muted); }
.news-cover-wrap { position:relative; width:100%; border-radius:14px; overflow:hidden; }
.news-cover {
  width:100%;
  border-radius:14px;
  aspect-ratio:16/7;
  object-fit:cover;
  background:#eef2ef;
}
.news-cover-overlay {
  position:absolute;
  inset:0;
  display:flex;
  align-items:flex-end;
  justify-content:flex-start;
  padding:1.4rem 1.5rem;
  background:linear-gradient(180deg, rgba(0,0,0,.12) 20%, rgba(0,0,0,.55) 100%);
}
.news-cover-overlay--left-top {
  align-items: flex-start;
  justify-content: flex-start;
  background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,.15) 55%, rgba(0,0,0,0) 100%);
}
.news-cover-overlay--right-top {
  align-items: flex-start;
  justify-content: flex-end;
  background: linear-gradient(180deg, rgba(0,0,0,.5) 0%, rgba(0,0,0,.15) 55%, rgba(0,0,0,0) 100%);
}
.news-cover-overlay--left-bottom {
  align-items: flex-end;
  justify-content: flex-start;
}
.news-cover-overlay--right-bottom {
  align-items: flex-end;
  justify-content: flex-end;
}
.news-cover-caption {
  margin:0;
  max-width:min(68ch, 74%);
  color:#fff;
  font-size:2.2rem;
  line-height:1.12;
  font-weight:700;
  text-shadow:0 2px 10px rgba(0,0,0,.4);
}
.news-body { display:flex; flex-direction:column; gap:.8rem; }
.news-rich-content :deep(p) { margin:0 0 .9rem; font-size:1.1rem; line-height:1.45; color:#1f2937; overflow-wrap:anywhere; }
.news-rich-content :deep(h2),
.news-rich-content :deep(h3),
.news-rich-content :deep(h4) { margin:.4rem 0 .7rem; line-height:1.3; color:#111827; }
.news-rich-content :deep(ul),
.news-rich-content :deep(ol) { margin:.2rem 0 .9rem; padding-left:1.25rem; }
.news-rich-content :deep(li) { margin:.2rem 0; color:#1f2937; line-height:1.45; }
.news-rich-content :deep(blockquote) { margin:0 0 .9rem; padding:.8rem 1rem; border-left:4px solid var(--agro); background:rgba(24,100,58,.06); border-radius:10px; color:#2f3a34; font-style:italic; font-size:1.12rem; line-height:1.45; }
.news-rich-content :deep(img) { display:block; width:auto; max-width:100%; height:auto; margin:.35rem 0 .95rem; border-radius:12px; object-fit:cover; background:#eef2ef; }
.news-rich-content :deep(img[data-size='100']) { width:100%; }
.news-rich-content :deep(img[data-size='75']) { width:75%; }
.news-rich-content :deep(img[data-size='50']) { width:50%; }
.news-rich-content :deep(a) { color:var(--agro); text-decoration:underline; }
.news-gallery-wrap { position:relative; display:flex; flex-direction:column; gap:.6rem; }
.news-gallery { display:grid; gap:.75rem; grid-template-columns:repeat(4,minmax(0,1fr)); }
.news-gallery.is-shifting-left .news-gallery-item-btn {
  animation: news-gallery-slide-left 260ms cubic-bezier(.22,.61,.36,1);
}
.news-gallery.is-shifting-right .news-gallery-item-btn {
  animation: news-gallery-slide-right 260ms cubic-bezier(.22,.61,.36,1);
}
.news-gallery-item-btn { border:none; background:transparent; padding:0; border-radius:12px; cursor:zoom-in; transition:transform .16s ease; }
.news-gallery-item-btn:hover { transform:translateY(-1px); }
.news-gallery-img { width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:12px; border:1px solid rgba(0,0,0,.06); }
.news-gallery-arrow {
  position:absolute;
  top:50%;
  transform:translateY(-50%);
  z-index:2;
  width:36px;
  height:36px;
  border-radius:999px;
  border:1px solid var(--line);
  background:rgba(255,255,255,.94);
  color:#344054;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  transition:all .16s ease;
}
.news-gallery-arrow:hover { transform:translateY(-50%) scale(1.04); border-color:rgba(61,92,64,.38); color:var(--agro); }
.news-gallery-arrow--prev { left:.55rem; }
.news-gallery-arrow--next { right:.55rem; }
@keyframes news-gallery-slide-left {
  0% { transform: translateX(12px); opacity: 0.72; }
  100% { transform: translateX(0); opacity: 1; }
}
@keyframes news-gallery-slide-right {
  0% { transform: translateX(-12px); opacity: 0.72; }
  100% { transform: translateX(0); opacity: 1; }
}
.news-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2500;
  background: rgba(4, 8, 12, 0.88);
  display: grid;
  place-items: center;
  padding: 2.2rem 4rem;
}
.news-lightbox-image {
  max-width: min(92vw, 1400px);
  max-height: 86vh;
  border-radius: 12px;
  object-fit: contain;
  box-shadow: 0 14px 40px rgba(0,0,0,.48);
}
.news-lightbox-close,
.news-lightbox-nav {
  position: absolute;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.28);
  background: rgba(16,24,40,.48);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all .16s ease;
}
.news-lightbox-close:hover,
.news-lightbox-nav:hover { background: rgba(16,24,40,.74); }
.news-lightbox-close:hover { transform: scale(1.04); }
.news-lightbox-close { top: 1.2rem; right: 1.2rem; }
.news-lightbox-nav { top: 50%; transform: translateY(-50%); }
.news-lightbox-nav:hover { transform: translateY(-50%) scale(1.04); }
.news-lightbox-nav--prev { left: 1rem; }
.news-lightbox-nav--next { right: 1rem; }

[data-theme='dark'] .news-back-btn,
[data-theme='dark'] .news-icon-btn {
  color: var(--text-primary);
}
[data-theme='dark'] .news-icon-btn {
  background: var(--bg-panel);
  border-color: var(--border-color);
}
[data-theme='dark'] .news-icon-btn--danger {
  color: color-mix(in srgb, white 78%, var(--danger-red));
  border-color: color-mix(in srgb, var(--danger-red) 35%, transparent);
}
[data-theme='dark'] .news-article {
  background: var(--bg-panel);
  border-color: var(--border-color);
}
[data-theme='dark'] .news-title { color: var(--text-primary); }
[data-theme='dark'] .news-rich-content :deep(p),
[data-theme='dark'] .news-rich-content :deep(li),
[data-theme='dark'] .news-rich-content :deep(h2),
[data-theme='dark'] .news-rich-content :deep(h3),
[data-theme='dark'] .news-rich-content :deep(h4) { color: var(--text-primary); }
[data-theme='dark'] .news-rich-content :deep(blockquote) {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--accent-green) 18%, transparent);
  border-left-color: var(--accent-green);
}
[data-theme='dark'] .news-rich-content :deep(a) { color: color-mix(in srgb, white 82%, var(--accent-green)); }
[data-theme='dark'] .news-gallery-img { border-color: var(--border-color); }
[data-theme='dark'] .news-gallery-arrow {
  background: color-mix(in srgb, var(--bg-elevated) 84%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}
@media (max-width:980px) {
  .news-article { padding: .95rem; }
  .news-title { font-size:1.65rem; }
  .news-cover-caption { font-size:1.7rem; max-width:85%; }
  .news-rich-content :deep(p),
  .news-rich-content :deep(blockquote) { font-size:1.02rem; }
}
@media (max-width:1100px) {
  .news-gallery { grid-template-columns:repeat(2,minmax(0,1fr)); gap:.6rem; }
}
@media (max-width:860px) {
  .news-details-top {
    align-items: flex-start;
  }
  .news-details-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .news-cover { aspect-ratio:16/8; }
}
@media (max-width:760px) {
  .news-article { border-radius:14px; padding:.8rem; }
  .news-title { font-size:1.3rem; line-height:1.22; }
  .news-date { font-size:.86rem; }
  .news-cover-overlay { padding:.9rem 1rem; }
  .news-cover-caption { font-size:1.2rem; max-width:100%; line-height:1.18; }
  .news-rich-content :deep(p),
  .news-rich-content :deep(blockquote) { font-size:.95rem; line-height:1.4; }
  .news-gallery { grid-template-columns:1fr; gap:.5rem; }
  .news-gallery-arrow { width:32px; height:32px; }
  .news-gallery-arrow--prev { left:.25rem; }
  .news-gallery-arrow--next { right:.25rem; }
  .news-lightbox { padding: 1rem 0.5rem; }
  .news-lightbox-image { max-width: 95vw; max-height: 82vh; }
  .news-lightbox-close { top: .65rem; right: .65rem; }
  .news-lightbox-nav { width: 38px; height: 38px; }
  .news-lightbox-nav--prev { left: .5rem; }
  .news-lightbox-nav--next { right: .5rem; }
}
</style>
