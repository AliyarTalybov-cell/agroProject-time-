<script setup lang="ts">
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

const form = ref({
  title: '',
  excerpt: '',
  coverExcerptPosition: 'left-bottom' as 'left-top' | 'right-top' | 'left-bottom' | 'right-bottom',
  coverImageUrl: '',
  publishedAt: '',
  content: '',
  galleryText: '',
})

const pageTitle = computed(() => (isEdit.value ? 'Редактирование новости' : 'Новая новость'))
const hasSelectedImage = computed(() => Boolean(selectedImage.value))

function nowLocalDateTime(): string {
  const d = new Date()
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
      publishedAt: row.published_at.slice(0, 16),
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
      form.value.publishedAt = publishedIso.slice(0, 16)
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
      form.value.publishedAt = publishedIso.slice(0, 16)
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

function insertHtmlAtCursor(html: string) {
  const selection = window.getSelection()
  if (!selection || !selection.rangeCount || !contentEditor.value) {
    contentEditor.value?.insertAdjacentHTML('beforeend', html)
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
  <section class="news-editor">
    <header class="news-editor-top">
      <h1 class="page-title">{{ pageTitle }}</h1>
      <button type="button" class="news-editor-back" @click="goBack">Отмена</button>
    </header>

    <p class="news-editor-hint">
      Вставляйте текст прямо из источника: базовое форматирование сохранится. Фото можно добавить в обложку, галерею и в основной текст.
    </p>
    <p v-if="error" class="news-editor-error">{{ error }}</p>

    <form class="news-editor-form" @submit.prevent="savePost">
      <label class="news-field">
        <span>Заголовок</span>
        <input v-model.trim="form.title" type="text" maxlength="160" placeholder="Например: Агропромкомплектация готовится к посевной кампании - 2026" />
      </label>

      <label class="news-field">
        <span>Короткое описание</span>
        <input v-model.trim="form.excerpt" type="text" maxlength="220" placeholder="Короткая подводка для карточки новости" />
      </label>

      <label class="news-field">
        <span>Позиция короткого описания на обложке</span>
        <select v-model="form.coverExcerptPosition" class="news-select">
          <option value="left-top">Слева сверху</option>
          <option value="right-top">Справа сверху</option>
          <option value="left-bottom">Слева снизу</option>
          <option value="right-bottom">Справа снизу</option>
        </select>
      </label>

      <div class="news-grid-two">
        <label class="news-field">
          <span>URL обложки</span>
          <input v-model.trim="form.coverImageUrl" type="url" placeholder="https://..." />
          <div class="news-upload-row">
            <label class="news-upload-btn">
              <input type="file" accept="image/*" :disabled="uploadingCover || saving || publishing || loading" @change="onCoverFilePick" />
              {{ uploadingCover ? 'Загрузка...' : 'Загрузить обложку' }}
            </label>
          </div>
        </label>
        <label class="news-field">
          <span>Дата публикации</span>
          <input v-model="form.publishedAt" type="datetime-local" />
        </label>
      </div>

      <div class="news-field">
        <span>Основной текст новости</span>
        <div class="news-editor-toolbar">
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="applyTextStyle('bold')">
            Ж
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="applyTextStyle('italic')">
            К
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="applyTextStyle('insertUnorderedList')">
            • Список
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="applyTextStyle('formatBlock')">
            Цитата
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="uploadingBodyImage || saving || publishing || loading" @click="triggerBodyImagePicker">
            {{ uploadingBodyImage ? 'Загрузка фото...' : 'Фото в текст' }}
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="toggleHtmlInsertPanel">
            Вставить HTML контент
          </button>
          <input ref="bodyImageInput" type="file" accept="image/*" class="news-hidden-input" :disabled="uploadingBodyImage || saving || publishing || loading" @change="onBodyImagePick" />
        </div>
        <div v-if="showHtmlInsertPanel" class="news-html-insert-panel">
          <textarea
            v-model="htmlInsertDraft"
            class="news-html-insert-textarea"
            rows="6"
            placeholder="<h2>Заголовок</h2><p>Текст...</p><img src='https://...'>"
          ></textarea>
          <div class="news-html-insert-actions">
            <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="insertHtmlContent">
              Вставить HTML
            </button>
            <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="toggleHtmlInsertPanel">
              Закрыть
            </button>
          </div>
        </div>
        <div class="news-image-size-row">
          <span>{{ hasSelectedImage ? 'Размер выбранного фото:' : 'Размер нового фото:' }}</span>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="setSelectedImageSize('100')">
            100%
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="setSelectedImageSize('75')">
            75%
          </button>
          <button type="button" class="news-toolbar-btn" :disabled="saving || publishing || loading" @click="setSelectedImageSize('50')">
            50%
          </button>
        </div>
        <div
          ref="contentEditor"
          class="news-rich-editor"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          data-placeholder="Вставьте текст новости — форматирование, заголовки, списки и абзацы сохранятся приблизительно как в источнике."
          @input="onContentInput"
          @paste="onContentPaste"
          @click="onEditorClick"
        ></div>
      </div>

      <label class="news-field">
        <span>Галерея (по одному URL на строку)</span>
        <textarea v-model="form.galleryText" rows="5" placeholder="https://...\nhttps://..." />
        <div class="news-upload-row">
          <label class="news-upload-btn">
            <input type="file" multiple accept="image/*" :disabled="uploadingGallery || saving || publishing || loading" @change="onGalleryFilesPick" />
            {{ uploadingGallery ? 'Загрузка фото...' : 'Добавить фото в галерею' }}
          </label>
        </div>
      </label>

      <div class="news-editor-actions">
        <button type="button" class="news-editor-btn news-editor-btn--ghost" :disabled="saving || publishing || loading" @click="goBack">Отмена</button>
        <button type="submit" class="news-editor-btn news-editor-btn--primary" :disabled="saving || publishing || loading">
          {{ saving ? 'Сохранение...' : 'Сохранить новость' }}
        </button>
        <button type="button" class="news-editor-btn news-editor-btn--publish" :disabled="saving || publishing || loading" @click="publishPost">
          {{ publishing ? 'Публикация...' : 'Опубликовать' }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.news-editor {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}
.news-editor-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.news-editor-back {
  height: 40px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.16s ease;
}
.news-editor-back:hover {
  transform: translateY(-1px);
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 40%, var(--border-color));
}
.news-editor-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.9375rem;
}
.news-editor-error {
  margin: 0;
  color: var(--danger-red);
  font-size: 0.9rem;
}
.news-editor-form {
  background: var(--bg-elevated);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  min-width: 0;
}
.news-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.news-field > span {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}
.news-field input,
.news-field textarea,
.news-select {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.9375rem;
  font-weight: 400;
  color: var(--text-primary);
  background: var(--bg-elevated);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.2s ease;
}
.news-field input::placeholder,
.news-field textarea::placeholder {
  color: var(--text-secondary);
}
.news-field input:focus,
.news-field textarea:focus,
.news-select:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.news-field textarea {
  resize: vertical;
  min-height: 140px;
  line-height: 1.45;
}
.news-editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.news-toolbar-btn {
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 0 10px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.16s ease;
}
.news-toolbar-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 38%, var(--border-color));
}
.news-toolbar-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}
.news-hidden-input {
  display: none;
}
.news-html-insert-panel {
  border: 1px dashed var(--border-color);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.news-html-insert-textarea,
.news-html-editor {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.9rem;
  font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace;
  color: var(--text-primary);
  background: var(--bg-elevated);
  line-height: 1.45;
}
.news-html-insert-actions,
.news-image-size-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.news-image-size-row > span {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}
.news-rich-editor {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 0.9375rem;
  font-weight: 400;
  color: var(--text-primary);
  background: var(--bg-elevated);
  min-height: 220px;
  line-height: 1.48;
  overflow-wrap: anywhere;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.2s ease;
}
.news-rich-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--text-secondary);
}
.news-rich-editor:focus {
  outline: none;
  border-color: var(--accent-green);
  box-shadow: 0 0 0 3px var(--focus-ring);
}
.news-rich-editor :deep(p) {
  margin: 0 0 0.8rem;
}
.news-rich-editor :deep(blockquote) {
  margin: 0 0 0.8rem;
  padding: 0.6rem 0.8rem;
  border-left: 3px solid var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 8%, transparent);
  border-radius: 8px;
}
.news-rich-editor :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0.4rem 0 0.8rem;
  border-radius: 10px;
  cursor: pointer;
}
.news-rich-editor :deep(img[data-size='100']) {
  width: 100%;
}
.news-rich-editor :deep(img[data-size='75']) {
  width: 75%;
}
.news-rich-editor :deep(img[data-size='50']) {
  width: 50%;
}
.news-select {
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--text-secondary) 50%), linear-gradient(135deg, var(--text-secondary) 50%, transparent 50%);
  background-position: calc(100% - 18px) calc(1em + 1px), calc(100% - 13px) calc(1em + 1px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.news-grid-two {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.news-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border-color);
}
.news-upload-row {
  margin-top: 2px;
}
.news-upload-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-elevated);
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.16s ease;
}
.news-upload-btn:hover {
  transform: translateY(-1px);
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 38%, var(--border-color));
}
.news-upload-btn input {
  display: none;
}
.news-editor-btn {
  height: 40px;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 0.875rem;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.16s ease, box-shadow 0.2s ease;
}
.news-editor-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}
.news-editor-btn--ghost {
  border-color: var(--border-color);
  background: var(--bg-elevated);
  color: var(--text-primary);
}
.news-editor-btn--ghost:hover:not(:disabled) {
  background: var(--bg-panel-hover);
  border-color: color-mix(in srgb, var(--accent-green) 35%, var(--border-color));
}

[data-theme='dark'] .news-editor-form,
[data-theme='dark'] .news-field input,
[data-theme='dark'] .news-field textarea,
[data-theme='dark'] .news-html-insert-textarea,
[data-theme='dark'] .news-rich-editor,
[data-theme='dark'] .news-toolbar-btn,
[data-theme='dark'] .news-select,
[data-theme='dark'] .news-upload-btn,
[data-theme='dark'] .news-editor-btn--ghost,
[data-theme='dark'] .news-editor-btn--ghost:hover:not(:disabled) {
  background: var(--bg-elevated);
}
[data-theme='dark'] .news-editor-hint,
[data-theme='dark'] .news-image-size-row > span {
  color: var(--text-secondary);
}
[data-theme='dark'] .news-field input,
[data-theme='dark'] .news-field textarea,
[data-theme='dark'] .news-select,
[data-theme='dark'] .news-html-insert-textarea,
[data-theme='dark'] .news-rich-editor {
  background: color-mix(in srgb, var(--bg-elevated) 86%, black);
  border-color: var(--border-color);
  color: var(--text-primary);
}
[data-theme='dark'] .news-field input::placeholder,
[data-theme='dark'] .news-field textarea::placeholder,
[data-theme='dark'] .news-rich-editor:empty::before {
  color: var(--text-muted);
}
[data-theme='dark'] .news-field input:focus,
[data-theme='dark'] .news-field textarea:focus,
[data-theme='dark'] .news-select:focus,
[data-theme='dark'] .news-rich-editor:focus {
  background: color-mix(in srgb, var(--bg-elevated) 94%, black);
}
[data-theme='dark'] .news-toolbar-btn,
[data-theme='dark'] .news-upload-btn,
[data-theme='dark'] .news-editor-btn--ghost {
  border-color: var(--border-color);
  color: var(--text-primary);
}
[data-theme='dark'] .news-html-insert-panel {
  border-color: var(--border-color);
  background: color-mix(in srgb, var(--bg-elevated) 92%, black);
}
.news-editor-btn--primary {
  background: var(--accent-green);
  color: #fff;
}
.news-editor-btn--primary:hover:not(:disabled) {
  background: var(--accent-green-hover);
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(61, 92, 64, 0.28);
}
.news-editor-btn--publish {
  background: var(--accent-green);
  color: #fff;
}
.news-editor-btn--publish:hover:not(:disabled) {
  background: var(--accent-green-hover);
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(61, 92, 64, 0.28);
}
@media (max-width: 980px) {
  .news-editor-form {
    padding: 12px;
    gap: 11px;
  }
  .news-field textarea {
    min-height: 120px;
  }
}
@media (max-width: 760px) {
  .news-grid-two {
    grid-template-columns: 1fr;
  }
  .news-editor-form {
    padding: 10px;
    gap: 10px;
  }
  .news-editor-actions {
    flex-wrap: wrap;
    justify-content: stretch;
  }
  .news-editor-btn {
    flex: 1;
    min-width: 130px;
  }
}
</style>
