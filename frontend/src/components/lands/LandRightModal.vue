<script setup lang="ts">
import UiDatePicker from '@/components/ui/UiDatePicker.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/**
 * Окно права владения земельным участком.
 *
 * Разметка перенесена из LandsPage дословно, классы с префиксом lands-
 * сохранены: стили к ним приходят из landsModal.css. Форма передаётся
 * объектом и правится на месте, как в остальных окнах раздела.
 *
 * Работа с файлами остаётся на странице: компонент только сообщает о выборе
 * файла (`upload`) и о просьбе удалить ссылку (`remove-file`), а загрузку в
 * хранилище и подтверждение удаления по-прежнему ведёт LandsPage.
 */
// Общие стили раздела: подключаются импортом, а не <style src>, — так файл
// попадает в сборку одной копией, а не отдельной на каждый компонент.
import './landsShared.css'
import ModalCloseButton from '@/components/ModalCloseButton.vue'
import type { LandRightForm } from '@/components/lands/types'
import { fileLabelFromUrl, isImageUrl } from '@/lib/fileLinks'
import type { LandRightHolderRow, LandRightRefRow } from '@/lib/landsSupabase'

defineProps<{
  open: boolean
  form: LandRightForm
  holders: LandRightHolderRow[]
  holderTypes: LandRightRefRow[]
  ownershipForms: LandRightRefRow[]
  rightTypes: LandRightRefRow[]
  documentTypes: LandRightRefRow[]
  /** Ссылки на приложенные файлы — считаются на странице из поля формы. */
  supportingLinks: string[]
  /** Идёт загрузка файла: блокирует форму вместе с saving. */
  uploading: boolean
  saving: boolean
  /** Идентификатор правимой записи: от него зависят заголовок и подпись кнопки. */
  editingId: string | null
}>()

defineEmits<{
  (e: 'save'): void
  (e: 'close'): void
  (e: 'upload', event: Event): void
  (e: 'remove-file', link: string): void
}>()
</script>

<template>
<div v-if="open" class="lands-modal-backdrop" role="dialog" aria-modal="true" aria-label="Право владения" @click.self="$emit('close')">
  <div class="lands-modal">
    <div class="lands-modal-head">
      <h2>{{ editingId ? 'Редактировать право владения' : 'Добавить право владения' }}</h2>
      <ModalCloseButton :disabled="saving || uploading" @click="$emit('close')" />
    </div>
    <div class="lands-modal-body">
      <div class="lands-owner-mode-section">
        <div class="lands-owner-mode-label">Правообладатель</div>
        <div class="lands-owner-mode-toggle" role="group" aria-label="Режим ввода правообладателя">
          <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': form.holderMode === 'reference' }" @click="form.holderMode = 'reference'">
            Выбрать из справочника
          </button>
          <button type="button" class="lands-owner-mode-btn" :class="{ 'is-active': form.holderMode === 'manual' }" @click="form.holderMode = 'manual'">
            Ввести вручную
          </button>
        </div>
      </div>
      <div v-if="form.holderMode === 'reference'" class="lands-form-grid">
        <label class="lands-field">
          <span>Правообладатель из справочника</span>
          <UiSelect v-model="form.holderRefId" :options="[{ value: '', label: '— Выберите правообладателя —' }, ...(holders).map((holder) => ({ value: holder.id, label: `${holder.name} · ИНН: ${holder.inn || '—'}` }))]" />
        </label>
        <div />
      </div>

      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Наименование *</span>
          <input v-model.trim="form.holderName" type="text" placeholder="СПК «Урожайный»" />
        </label>
        <label class="lands-field">
          <span>Вид правообладания</span>
          <UiSelect v-model="form.holderTypeId" :options="[{ value: '', label: '—' }, ...(holderTypes).map((row) => ({ value: row.id, label: String(row.name) }))]" :disabled="form.holderMode === 'reference'" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>ИНН *</span>
          <input v-model.trim="form.holderInn" type="text" />
        </label>
        <label class="lands-field">
          <span>КПП</span>
          <input v-model.trim="form.holderKpp" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>ОГРН *</span>
          <input v-model.trim="form.holderOgrn" type="text" />
        </label>
        <div />
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Кадастровый номер *</span>
          <input v-model.trim="form.cadastralNumber" type="text" />
        </label>
        <label class="lands-field">
          <span class="lands-label-with-help">
            Форма собственности *
            <RefFieldHelp
              text="Нет нужной формы собственности? Добавьте ее в"
              :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
              link-label="Справочники прав"
            />
          </span>
          <UiSelect v-model="form.ownershipForm" :options="[{ value: '', label: '— Выберите форму собственности —' }, ...(ownershipForms).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span class="lands-label-with-help">
            Вид права *
            <RefFieldHelp
              text="Нет нужного вида права? Добавьте его в"
              :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
              link-label="Справочники прав"
            />
          </span>
          <UiSelect v-model="form.rightType" :options="[{ value: '', label: '— Выберите вид права —' }, ...(rightTypes).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
        <label class="lands-field">
          <span class="lands-label-with-help">
            Тип подтверждающего документа *
            <RefFieldHelp
              text="Нет нужного типа документа? Добавьте его в"
              :to="{ path: '/lands', query: { tab: 'rights-refs' } }"
              link-label="Справочники прав"
            />
          </span>
          <UiSelect v-model="form.documentType" :options="[{ value: '', label: '— Выберите тип документа —' }, ...(documentTypes).map((row) => ({ value: row.name, label: String(row.name) }))]" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Подтверждающие документы *</span>
          <div class="lands-docs-compact-box">
            <div class="lands-docs-compact-head">
              <span class="lands-docs-compact-state" :class="{ 'is-filled': supportingLinks.length > 0 }">
                {{ supportingLinks.length ? `Приложено файлов: ${supportingLinks.length}` : 'Файлы не приложены' }}
              </span>
            </div>
            <div v-if="supportingLinks.length" class="lands-docs-preview-grid lands-docs-preview-grid--compact">
              <div v-for="link in supportingLinks" :key="link" class="lands-docs-preview-card-wrap">
                <a
                  :href="link"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="lands-docs-preview-card"
                >
                  <div class="lands-docs-preview-thumb-wrap">
                    <img v-if="isImageUrl(link)" class="lands-docs-preview-thumb" :src="link" :alt="fileLabelFromUrl(link)" loading="lazy" />
                    <svg v-else class="lands-docs-preview-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
                    </svg>
                  </div>
                  <span class="lands-docs-preview-name">{{ fileLabelFromUrl(link) }}</span>
                </a>
                <button type="button" class="lands-docs-remove-btn" title="Удалить файл" aria-label="Удалить файл" :disabled="uploading || saving" @click="$emit('remove-file', link)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>
          </div>
        </label>
        <label class="lands-field">
          <span>Загрузить документ/фото</span>
          <label class="lands-file-upload">
            <span class="lands-file-upload-btn">{{ uploading ? 'Загрузка...' : 'Выбрать файл' }}</span>
            <span class="lands-file-upload-hint">PDF, JPG, PNG, DOC, DOCX, ZIP</span>
            <input class="lands-file-upload-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.zip" :disabled="uploading || saving" @change="$emit('upload', $event)" />
          </label>
          <span class="lands-muted">{{ uploading ? 'Файл загружается...' : 'После загрузки появится мини-превью.' }}</span>
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Документ (наименование)</span>
          <input v-model.trim="form.documentName" type="text" />
        </label>
        <label class="lands-field">
          <span>Номер документа</span>
          <input v-model.trim="form.documentNumber" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Дата документа</span>
          <UiDatePicker v-model="form.documentDate" />
        </label>
        <label class="lands-field">
          <span>Примечание</span>
          <input v-model.trim="form.notes" type="text" />
        </label>
      </div>
      <div class="lands-form-grid">
        <label class="lands-field">
          <span>Начало владения *</span>
          <UiDatePicker v-model="form.startsAt" />
        </label>
        <label class="lands-field">
          <span>Окончание *</span>
          <UiDatePicker v-model="form.endsAt" />
        </label>
      </div>
    </div>
    <div class="lands-modal-actions">
      <button type="button" class="lands-btn" :disabled="saving || uploading" @click="$emit('close')">Отмена</button>
      <button type="button" class="lands-btn lands-btn--save" :disabled="saving || uploading" @click="$emit('save')">
        {{ saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Добавить' }}
      </button>
    </div>
  </div>
</div>
</template>

