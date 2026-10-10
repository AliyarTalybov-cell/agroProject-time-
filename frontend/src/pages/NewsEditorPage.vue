<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Button } from '@/components/ui/shadcn/button'
import UiDateTimePicker from '@/components/ui/UiDateTimePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Separator } from '@/components/ui/shadcn/separator'
import { BoldIcon, CodeIcon, ImagePlusIcon, ImageUpIcon, ItalicIcon, ListIcon, QuoteIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getAuthUser } from '@/stores/auth'
import { createNewsPost, getNewsPostById, isSupabaseConfigured, updateNewsPost, uploadNewsImage } from '@/lib/newsSupabase'
import { hasMeaningfulNewsContent, normalizeNewsContentToHtml, sanitizeNewsHtml } from '@/lib/newsContent'

const route = useRoute()
const router = useRouter()
const isEdit = computed(() => Boolean(route.params.id))
const postId = computed(() => String(route.params.id || ''))

const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const uploadingCover = ref(false)
const uploadingGallery = ref(false)
const uploadingBodyImage = ref(false)
const error = ref<string | null>(null)
const contentEditor = ref<HTMLDivElement | null>(null)
const bodyImageInput = ref<HTMLInputElement | null>(null)
const showHtmlInsertPanel = ref(false)
const htmlInsertDraft = ref('')
const selectedImage = ref<HTMLImageElement | null>(null)
const defaultImageSize = ref<'100' | '75' | '50'>('100')
let savedEditorRange: Range | null = null

const form = ref({
  title: '',
  excerpt: '',
  coverExcerptPosition: 'left-bottom' as 'left-top' | 'right-top' | 'left-bottom' | 'right-bottom',
  coverImageUrl: '',
  publishedAt: '',
  content: '',
  galleryText: '',
})

const hasSelectedImage = computed(() => Boolean(selectedImage.value))
const busy = computed(() => saving.value || publishing.value || loading.value)
const coverInput = ref<HTMLInputElement | null>(null)
const galleryInput = ref<HTMLInputElement | null>(null)
const imageSizes = ['100', '75', '50'] as const
const currentImageSize = computed(() => selectedImage.value?.getAttribute('data-size') ?? defaultImageSize.value)
const coverPositionOptions = [
  { value: 'left-top', label: 'Слева сверху' },
  { value: 'right-top', label: 'Справа сверху' },
  { value: 'left-bottom', label: 'Слева снизу' },
  { value: 'right-bottom', label: 'Справа снизу' },
]

function nowLocalDateTime(): string {
  return toLocalDateTime(new Date())
}

/** Дата для поля «Дата публикации» — в местном времени, а не в UTC из базы. */
function toLocalDateTime(value: Date | string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return nowLocalDateTime()
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseGallery(value: string): string[] {
  return value.split('\n').map((x) => x.trim()).filter(Boolean)
}

async function loadData() {
  if (!isEdit.value || !isSupabaseConfigured()) {
    form.value.publishedAt = nowLocalDateTime()
    form.value.content = ''
    return
  }
  loading.value = true
  error.value = null
  try {
    const row = await getNewsPostById(postId.value)
    if (!row) {
      error.value = 'Новость не найдена'
      return
    }
    form.value = {
      title: row.title,
      excerpt: row.excerpt ?? '',
      coverExcerptPosition: row.cover_excerpt_position ?? 'left-bottom',
      coverImageUrl: row.cover_image_url ?? '',
      publishedAt: toLocalDateTime(row.published_at),
      content: normalizeNewsContentToHtml(row.content),
      galleryText: (row.gallery_urls ?? []).join('\n'),
    }
    await nextTick()
    syncEditorContent()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить новость'
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (isEdit.value) {
    void router.push({ name: 'news-details', params: { id: postId.value } })
    return
  }
  void router.push({ name: 'news' })
}

async function savePost() {
  await persistPost(false)
}

async function publishPost() {
  await persistPost(true)
}

async function persistPost(publishNow: boolean) {
  if (!isSupabaseConfigured()) {
    error.value = 'Supabase не настроен'
    return
  }
  syncFormContentFromEditor()
  const editorText = (contentEditor.value?.innerText || '').replace(/\u00a0/g, ' ').trim()
  const editorHasMedia = Boolean(contentEditor.value?.querySelector('img, hr'))
  const hasBodyContent = editorText.length > 0 || editorHasMedia || hasMeaningfulNewsContent(form.value.content)
  if (!form.value.title.trim() || !hasBodyContent) {
    error.value = 'Заполните заголовок и основной текст'
    return
  }
  if (publishNow) publishing.value = true
  else saving.value = true
  error.value = null
  try {
    const galleryUrls = parseGallery(form.value.galleryText)
    const publishedIso = publishNow
      ? new Date().toISOString()
      : new Date(form.value.publishedAt || nowLocalDateTime()).toISOString()
    if (isEdit.value) {
      await updateNewsPost(postId.value, {
        title: form.value.title,
        excerpt: form.value.excerpt || null,
        cover_excerpt_position: form.value.coverExcerptPosition,
        cover_image_url: form.value.coverImageUrl || null,
        content: sanitizeNewsHtml(form.value.content),
        gallery_urls: galleryUrls,
        published_at: publishedIso,
      })
      form.value.publishedAt = toLocalDateTime(publishedIso)
      void router.push({ name: 'news-details', params: { id: postId.value } })
    } else {
      const createdBy = getAuthUser()?.id ?? null
      const row = await createNewsPost({
        title: form.value.title,
        excerpt: form.value.excerpt || null,
        cover_excerpt_position: form.value.coverExcerptPosition,
        cover_image_url: form.value.coverImageUrl || null,
        content: sanitizeNewsHtml(form.value.content),
        gallery_urls: galleryUrls,
        published_at: publishedIso,
        created_by: createdBy,
      })
      form.value.publishedAt = toLocalDateTime(publishedIso)
      void router.push({ name: 'news-details', params: { id: row.id } })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : publishNow ? 'Не удалось опубликовать новость' : 'Не удалось сохранить новость'
  } finally {
    if (publishNow) publishing.value = false
    else saving.value = false
  }
}

async function onCoverFilePick(event: Event) {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file || !isSupabaseConfigured()) return
  uploadingCover.value = true
  error.value = null
  try {
    const url = await uploadNewsImage(file, 'covers')
    form.value.coverImageUrl = url
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить обложку'
  } finally {
    uploadingCover.value = false
    if (target) target.value = ''
  }
}

async function onGalleryFilesPick(event: Event) {
  const target = event.target as HTMLInputElement | null
  const files = Array.from(target?.files ?? [])
  if (!files.length || !isSupabaseConfigured()) return
  uploadingGallery.value = true
  error.value = null
  try {
    const uploadedUrls: string[] = []
    for (const file of files) {
      uploadedUrls.push(await uploadNewsImage(file, 'gallery'))
    }
    const existing = parseGallery(form.value.galleryText)
    form.value.galleryText = [...existing, ...uploadedUrls].join('\n')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить фото для галереи'
  } finally {
    uploadingGallery.value = false
    if (target) target.value = ''
  }
}

function syncEditorContent() {
  if (!contentEditor.value) return
  const safeHtml = normalizeNewsContentToHtml(form.value.content)
  contentEditor.value.innerHTML = safeHtml
  form.value.content = safeHtml
}

function syncFormContentFromEditor(rewriteEditor = true) {
  if (!contentEditor.value) return
  const safeHtml = sanitizeNewsHtml(contentEditor.value.innerHTML)
  if (rewriteEditor) contentEditor.value.innerHTML = safeHtml
  form.value.content = safeHtml
}

function onContentInput() {
  if (!contentEditor.value) return
  form.value.content = contentEditor.value.innerHTML
}

function onContentPaste() {
  window.setTimeout(() => {
    if (!contentEditor.value) return
    form.value.content = contentEditor.value.innerHTML
  }, 0)
}

function applyTextStyle(command: 'bold' | 'italic' | 'insertUnorderedList' | 'formatBlock') {
  contentEditor.value?.focus()
  if (command === 'formatBlock') {
    document.execCommand(command, false, 'blockquote')
  } else {
    document.execCommand(command, false)
  }
  syncFormContentFromEditor()
}

function triggerBodyImagePicker() {
  bodyImageInput.value?.click()
}

function rememberEditorCaret() {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !contentEditor.value) return
  const range = selection.getRangeAt(0)
  if (contentEditor.value.contains(range.commonAncestorContainer)) savedEditorRange = range.cloneRange()
}

function insertHtmlAtCursor(html: string) {
  const selection = window.getSelection()
  const editor = contentEditor.value
  if (!editor) return
  // Курсор мог уйти в поле HTML — вставляем туда, где он стоял в тексте, иначе в конец.
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
    selection?.removeAllRanges()
    selection?.addRange(savedEditorRange)
  }
  if (!selection || !selection.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    editor.insertAdjacentHTML('beforeend', html)
    return
  }
  const range = selection.getRangeAt(0)
  range.deleteContents()
  const fragment = range.createContextualFragment(html)
  range.insertNode(fragment)
  selection.collapseToEnd()
}

async function onBodyImagePick(event: Event) {
  const target = event.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file || !isSupabaseConfigured()) return
  uploadingBodyImage.value = true
  error.value = null
  try {
    const url = await uploadNewsImage(file, 'content')
    insertHtmlAtCursor(`<p><img src="${url}" alt="Изображение новости" data-size="${defaultImageSize.value}"></p>`)
    syncFormContentFromEditor()
    const images = contentEditor.value?.querySelectorAll('img')
    if (images && images.length > 0) {
      selectedImage.value = images[images.length - 1] as HTMLImageElement
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить фото в текст новости'
  } finally {
    uploadingBodyImage.value = false
    if (target) target.value = ''
  }
}

function toggleHtmlInsertPanel() {
  showHtmlInsertPanel.value = !showHtmlInsertPanel.value
  if (showHtmlInsertPanel.value) htmlInsertDraft.value = ''
}

function insertHtmlContent() {
  const sanitizedHtml = sanitizeNewsHtml(htmlInsertDraft.value)
  if (!sanitizedHtml) return
  contentEditor.value?.focus()
  insertHtmlAtCursor(sanitizedHtml)
  syncFormContentFromEditor()
  htmlInsertDraft.value = ''
  showHtmlInsertPanel.value = false
}

function onEditorClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target || target.tagName !== 'IMG') return
  selectedImage.value = target as HTMLImageElement
}

function setSelectedImageSize(size: '100' | '75' | '50') {
  defaultImageSize.value = size
  const activeImage = selectedImage.value && selectedImage.value.isConnected
    ? selectedImage.value
    : contentEditor.value?.querySelector('img:last-of-type') ?? null
  if (!activeImage) return
  activeImage.setAttribute('data-size', size)
  selectedImage.value = activeImage as HTMLImageElement
  syncFormContentFromEditor()
}

onMounted(async () => {
  await loadData()
  syncEditorContent()
})
</script>

<template>
  <section class="tw-scope flex min-w-0 flex-col gap-6">
    <form class="flex min-w-0 flex-col gap-6 rounded-xl border bg-card p-4 shadow-xs md:p-6" @submit.prevent="savePost">
      <FormGrid :cols="2">
        <FormField label="Заголовок" for="news-title" wide required :count="form.title.length" :max="160">
          <Input id="news-title" v-model.trim="form.title" type="text" maxlength="160" placeholder="Например: Агропромкомплектация готовится к посевной кампании — 2026" />
        </FormField>

        <FormField label="Короткое описание" for="news-excerpt" wide hint="Подводка на обложке и в карточке новости" :count="form.excerpt.length" :max="220">
          <Input id="news-excerpt" v-model.trim="form.excerpt" type="text" maxlength="220" placeholder="Коротко о главном" />
        </FormField>

        <FormField label="Где показать описание на обложке">
          <UiSelect v-model="form.coverExcerptPosition" :options="coverPositionOptions" />
        </FormField>

        <FormField label="Дата публикации" hint="«Опубликовать сейчас» поставит текущее время">
          <UiDateTimePicker v-model="form.publishedAt" />
        </FormField>

        <FormField label="Обложка" for="news-cover" wide hint="Ссылка на картинку или файл с компьютера">
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input id="news-cover" v-model.trim="form.coverImageUrl" type="url" placeholder="https://..." class="min-w-0 flex-1" />
            <Button variant="outline" type="button" :disabled="uploadingCover || busy" @click="coverInput?.click()">
              <ImageUpIcon />
              {{ uploadingCover ? 'Загрузка…' : 'Загрузить файл' }}
            </Button>
            <input ref="coverInput" type="file" accept="image/*" class="hidden" :disabled="uploadingCover || busy" @change="onCoverFilePick" />
          </div>
        </FormField>

        <FormField label="Основной текст" wide hint="Вставляйте текст прямо из источника — заголовки, списки и абзацы сохранятся. Нажмите на фото в тексте, чтобы поменять его размер.">
          <div class="news-editor-box min-w-0 overflow-hidden rounded-md border bg-background shadow-xs dark:border-input dark:bg-input/30">
            <div class="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1">
              <Button variant="ghost" size="icon-sm" type="button" title="Жирный" aria-label="Жирный" :disabled="busy" @click="applyTextStyle('bold')">
                <BoldIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" title="Курсив" aria-label="Курсив" :disabled="busy" @click="applyTextStyle('italic')">
                <ItalicIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" title="Список" aria-label="Список" :disabled="busy" @click="applyTextStyle('insertUnorderedList')">
                <ListIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" type="button" title="Цитата" aria-label="Цитата" :disabled="busy" @click="applyTextStyle('formatBlock')">
                <QuoteIcon />
              </Button>
              <Separator orientation="vertical" class="mx-1 !h-5" />
              <Button variant="ghost" size="sm" type="button" :disabled="uploadingBodyImage || busy" @click="triggerBodyImagePicker">
                <ImagePlusIcon />
                {{ uploadingBodyImage ? 'Загрузка…' : 'Фото' }}
              </Button>
              <Button variant="ghost" size="sm" type="button" :class="showHtmlInsertPanel ? 'bg-accent' : ''" :aria-pressed="showHtmlInsertPanel" :disabled="busy" @click="toggleHtmlInsertPanel">
                <CodeIcon />
                HTML
              </Button>
              <Separator orientation="vertical" class="mx-1 hidden !h-5 sm:block" />
              <div class="flex items-center gap-1">
                <span class="px-1 text-xs text-muted-foreground">{{ hasSelectedImage ? 'Выбранное фото' : 'Новое фото' }}</span>
                <Button
                  v-for="size in imageSizes"
                  :key="size"
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="px-2 tabular-nums"
                  :class="currentImageSize === size ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
                  :aria-pressed="currentImageSize === size"
                  :disabled="busy"
                  @click="setSelectedImageSize(size)"
                >
                  {{ size }}%
                </Button>
              </div>
              <input ref="bodyImageInput" type="file" accept="image/*" class="hidden" :disabled="uploadingBodyImage || busy" @change="onBodyImagePick" />
            </div>
            <div v-if="showHtmlInsertPanel" class="flex flex-col gap-2 border-b p-2">
              <Textarea
                v-model="htmlInsertDraft"
                class="min-h-32 font-mono text-xs"
                rows="6"
                aria-label="HTML для вставки"
                placeholder="<h2>Заголовок</h2><p>Текст…</p><img src='https://…'>" />
              <div class="flex justify-end gap-2">
                <Button variant="outline" size="sm" type="button" :disabled="busy" @click="toggleHtmlInsertPanel">Закрыть</Button>
                <Button size="sm" type="button" :disabled="busy || !htmlInsertDraft.trim()" @click="insertHtmlContent">Вставить в текст</Button>
              </div>
            </div>
            <div
              ref="contentEditor"
              class="news-rich-editor"
              contenteditable="true"
              role="textbox"
              aria-multiline="true"
              aria-label="Основной текст новости"
              data-placeholder="Вставьте или напишите текст новости"
              @input="onContentInput"
              @paste="onContentPaste"
              @click="onEditorClick"
              @keyup="rememberEditorCaret"
              @mouseup="rememberEditorCaret"
              @blur="rememberEditorCaret"
            ></div>
          </div>
        </FormField>

        <FormField label="Галерея" for="news-gallery" wide hint="По одной ссылке на строку">
          <template #label-actions>
            <Button variant="outline" size="sm" type="button" :disabled="uploadingGallery || busy" @click="galleryInput?.click()">
              <ImagePlusIcon />
              {{ uploadingGallery ? 'Загрузка…' : 'Добавить фото' }}
            </Button>
            <input ref="galleryInput" type="file" multiple accept="image/*" class="hidden" :disabled="uploadingGallery || busy" @change="onGalleryFilesPick" />
          </template>
          <Textarea id="news-gallery" v-model="form.galleryText" rows="4" class="min-h-24" placeholder="https://...&#10;https://..." />
        </FormField>
      </FormGrid>

      <Alert v-if="error" variant="destructive">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <div class="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end md:pt-6">
        <Button variant="outline" type="button" :disabled="busy" @click="goBack">Отмена</Button>
        <Button variant="outline" type="button" :disabled="busy" @click="publishPost">
          {{ publishing ? 'Публикация…' : 'Опубликовать сейчас' }}
        </Button>
        <Button type="submit" :disabled="busy">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </Button>
      </div>
    </form>
  </section>
</template>

<style scoped>
/* Вне слоёв: оформление вставленного текста сильнее сброса tw-scope. */
.news-rich-editor {
  min-height: 240px;
  padding: 12px;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--foreground);
  overflow-wrap: anywhere;
  outline: none;
}
.news-editor-box:has(.news-rich-editor:focus) {
  border-color: var(--ring);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent);
}
.news-rich-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--muted-foreground);
}
.news-rich-editor :deep(p) {
  margin: 0 0 12px;
}
.news-rich-editor :deep(h2),
.news-rich-editor :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
  line-height: 1.3;
}
.news-rich-editor :deep(h2) { font-size: 1.25rem; }
.news-rich-editor :deep(h3) { font-size: 1.0625rem; }
.news-rich-editor :deep(ul),
.news-rich-editor :deep(ol) {
  margin: 0 0 12px;
  padding-left: 24px;
}
.news-rich-editor :deep(ul) { list-style: disc; }
.news-rich-editor :deep(ol) { list-style: decimal; }
.news-rich-editor :deep(blockquote) {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-left: 3px solid var(--primary);
  background: var(--muted);
  border-radius: 6px;
}
.news-rich-editor :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 8px 0 12px;
  border-radius: 8px;
  cursor: pointer;
}
.news-rich-editor :deep(img[data-size='100']) { width: 100%; }
.news-rich-editor :deep(img[data-size='75']) { width: 75%; }
.news-rich-editor :deep(img[data-size='50']) { width: 50%; }
</style>
