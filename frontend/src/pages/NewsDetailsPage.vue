<script setup lang="ts">
import { askConfirm } from '@/composables/useConfirm'
import { Button } from '@/components/ui/shadcn/button'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { ChevronLeftIcon, ChevronRightIcon, PenLineIcon, Trash2Icon, XIcon } from '@lucide/vue'
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
  if (!(await askConfirm('Удалить эту новость?'))) return
  await deleteNewsPost(postId.value)
  goBack()
}

onMounted(() => void loadData())
</script>

<template>
  <section class="news-details">
    <div v-if="isManager && post" class="tw-scope mb-4 flex justify-end gap-2">
      <Button variant="outline" size="sm" type="button" @click="openEdit">
        <PenLineIcon />
        Изменить
      </Button>
      <Button variant="ghost" size="sm" type="button" class="text-destructive hover:bg-destructive/10 hover:text-destructive" @click="removePost">
        <Trash2Icon />
        Удалить
      </Button>
    </div>

    <div v-if="loading"><UiLoadingBar /></div>
    <Alert v-else-if="error" variant="destructive" class="tw-scope">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <article v-else-if="post" class="news-article page-enter-item">
      <h1 class="news-title">{{ post.title }}</h1>
      <p class="news-date">{{ formatDate(post.published_at) }}</p>
      <div v-if="post.cover_image_url" class="news-cover-wrap">
        <img :src="post.cover_image_url" :alt="post.title" class="news-cover" />
        <div v-if="post.excerpt" class="news-cover-overlay" :class="`news-cover-overlay--${post.cover_excerpt_position || 'left-bottom'}`">
          <p class="news-cover-caption">{{ post.excerpt }}</p>
        </div>
      </div>
      <p v-if="post.excerpt" class="news-lead" :class="{ 'news-lead--with-cover': post.cover_image_url }">{{ post.excerpt }}</p>
      <div class="news-body news-rich-content" v-html="renderedBodyHtml" />
      <div v-if="galleryImages.length" class="news-gallery-wrap">
        <button
          v-if="hasGalleryPager"
          type="button"
          class="news-gallery-arrow news-gallery-arrow--prev"
          aria-label="Предыдущее фото"
          @click="prevGalleryPage"
        >
          <ChevronLeftIcon :size="18" />
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
          <ChevronRightIcon :size="18" />
        </button>
      </div>
    </article>
    <teleport to="body">
      <div v-if="lightboxImage" class="news-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр фото" @click.self="closeLightbox">
        <button type="button" class="news-lightbox-close" aria-label="Закрыть" @click="closeLightbox">
          <XIcon :size="20" />
        </button>
        <button type="button" class="news-lightbox-nav news-lightbox-nav--prev" aria-label="Предыдущее фото" @click="lightboxPrev">
          <ChevronLeftIcon :size="22" />
        </button>
        <img :src="lightboxImage" alt="Фото новости" class="news-lightbox-image" />
        <button type="button" class="news-lightbox-nav news-lightbox-nav--next" aria-label="Следующее фото" @click="lightboxNext">
          <ChevronRightIcon :size="22" />
        </button>
      </div>
    </teleport>
  </section>
</template>

<style scoped>
@layer legacy {
.news-details { display:flex; flex-direction:column; min-width:0; }
.news-article { width:100%; background:var(--card); color:var(--card-foreground); border:1px solid var(--border); border-radius:12px; padding:24px; display:flex; flex-direction:column; gap:16px; min-width:0; }
.news-title { margin:0; font-size:2rem; font-weight:700; line-height:1.15; text-wrap:balance; overflow-wrap:anywhere; color:var(--foreground); }
.news-date { margin:-8px 0 0; font-size:0.875rem; color:var(--muted-foreground); }
.news-cover-wrap { position:relative; width:100%; border-radius:12px; overflow:hidden; background:var(--muted); }
.news-cover { display:block; width:100%; aspect-ratio:16/7; object-fit:cover; }
.news-cover-overlay {
  position:absolute;
  inset:0;
  display:flex;
  align-items:flex-end;
  justify-content:flex-start;
  padding:24px;
  background:linear-gradient(180deg, rgb(0 0 0 / .1) 20%, rgb(0 0 0 / .55) 100%);
}
.news-cover-overlay--left-top,
.news-cover-overlay--right-top {
  align-items:flex-start;
  background:linear-gradient(180deg, rgb(0 0 0 / .5) 0%, rgb(0 0 0 / .15) 55%, transparent 100%);
}
.news-cover-overlay--right-top,
.news-cover-overlay--right-bottom { justify-content:flex-end; }
.news-cover-caption {
  margin:0;
  max-width:min(60ch, 70%);
  color:#fff;
  font-size:1.75rem;
  line-height:1.15;
  font-weight:600;
  text-shadow:0 2px 10px rgb(0 0 0 / .4);
}
/* Подводка текстом: без обложки — всегда, с обложкой — только на телефоне вместо надписи на фото. */
.news-lead { margin:0; font-size:1.125rem; line-height:1.45; font-weight:500; color:var(--foreground); }
.news-lead--with-cover { display:none; }
.news-body { display:flex; flex-direction:column; }
.news-rich-content { font-size:1.0625rem; line-height:1.6; color:var(--foreground); }
.news-rich-content :deep(p) { margin:0 0 16px; overflow-wrap:anywhere; }
/* Пустые абзацы из вставленного текста не дают лишних дыр. */
.news-rich-content :deep(p:empty),
.news-rich-content > :deep(br) { display:none; }
.news-rich-content :deep(h2),
.news-rich-content :deep(h3),
.news-rich-content :deep(h4) { margin:8px 0 12px; line-height:1.3; font-weight:600; color:var(--foreground); }
.news-rich-content :deep(h2) { font-size:1.375rem; }
.news-rich-content :deep(h3) { font-size:1.1875rem; }
.news-rich-content :deep(ul),
.news-rich-content :deep(ol) { margin:0 0 16px; padding-left:24px; }
.news-rich-content :deep(li) { margin:4px 0; }
.news-rich-content :deep(blockquote) { margin:0 0 16px; padding:12px 16px; border-left:3px solid var(--primary); background:var(--muted); border-radius:8px; font-style:italic; }
.news-rich-content :deep(blockquote p:last-child) { margin-bottom:0; }
.news-rich-content :deep(img) { display:block; width:auto; max-width:100%; height:auto; margin:8px 0 16px; border-radius:12px; object-fit:cover; background:var(--muted); }
.news-rich-content :deep(img[data-size='100']) { width:100%; }
.news-rich-content :deep(img[data-size='75']) { width:75%; }
.news-rich-content :deep(img[data-size='50']) { width:50%; }
.news-rich-content :deep(a) { color:var(--primary); text-decoration:underline; text-underline-offset:2px; }
.news-rich-content > :deep(:last-child) { margin-bottom:0; }
.news-gallery-wrap { position:relative; display:flex; flex-direction:column; gap:8px; }
.news-gallery { display:grid; gap:12px; grid-template-columns:repeat(4,minmax(0,1fr)); }
.news-gallery.is-shifting-left .news-gallery-item-btn {
  animation: news-gallery-slide-left 260ms cubic-bezier(.22,.61,.36,1);
}
.news-gallery.is-shifting-right .news-gallery-item-btn {
  animation: news-gallery-slide-right 260ms cubic-bezier(.22,.61,.36,1);
}
.news-gallery-item-btn { border:none; background:transparent; padding:0; border-radius:12px; cursor:zoom-in; }
.news-gallery-img { display:block; width:100%; aspect-ratio:4/3; object-fit:cover; border-radius:12px; border:1px solid var(--border); background:var(--muted); }
.news-gallery-arrow {
  position:absolute;
  top:50%;
  transform:translateY(-50%);
  z-index:2;
  width:36px;
  height:36px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--background);
  color:var(--foreground);
  box-shadow:0 1px 3px rgb(0 0 0 / .12);
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
}
.news-gallery-arrow:hover { background:var(--accent); }
.news-gallery-arrow--prev { left:8px; }
.news-gallery-arrow--next { right:8px; }
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
  background: rgb(4 8 12 / .88);
  display: grid;
  place-items: center;
  padding: 32px 64px;
}
.news-lightbox-image {
  max-width: min(92vw, 1400px);
  max-height: 86vh;
  border-radius: 12px;
  object-fit: contain;
}
.news-lightbox-close,
.news-lightbox-nav {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgb(255 255 255 / .28);
  background: rgb(16 24 40 / .48);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.news-lightbox-close:hover,
.news-lightbox-nav:hover { background: rgb(16 24 40 / .74); }
.news-lightbox-close { top: 16px; right: 16px; }
.news-lightbox-nav { top: 50%; transform: translateY(-50%); }
.news-lightbox-nav--prev { left: 16px; }
.news-lightbox-nav--next { right: 16px; }
@media (max-width:1100px) {
  .news-gallery { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media (max-width:767px) {
  .news-article { padding:16px; }
  .news-title { font-size:1.375rem; line-height:1.25; }
  .news-cover { aspect-ratio:16/9; }
  .news-cover-overlay { display:none; }
  .news-lead--with-cover { display:block; }
  .news-lead { font-size:1rem; }
  .news-rich-content { font-size:1rem; line-height:1.55; }
  .news-rich-content :deep(h2) { font-size:1.1875rem; }
  .news-rich-content :deep(h3) { font-size:1.0625rem; }
  .news-rich-content :deep(img[data-size='75']),
  .news-rich-content :deep(img[data-size='50']) { width:100%; }
  .news-gallery { gap:8px; }
  .news-gallery-arrow { width:32px; height:32px; }
  .news-lightbox { padding: 16px 8px; }
  .news-lightbox-image { max-width: 95vw; max-height: 82vh; }
  .news-lightbox-close { top: 12px; right: 12px; }
  .news-lightbox-nav--prev { left: 8px; }
  .news-lightbox-nav--next { right: 8px; }
}
}
</style>
