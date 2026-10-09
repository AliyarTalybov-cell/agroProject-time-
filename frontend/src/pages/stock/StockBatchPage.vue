<script setup lang="ts">
import { Input } from '@/components/ui/shadcn/input'
import { Button } from '@/components/ui/shadcn/button'
import { Textarea } from '@/components/ui/shadcn/textarea'
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert'
import { Skeleton } from '@/components/ui/shadcn/skeleton'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/shadcn/empty'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/shadcn/dropdown-menu'
import { ArrowLeftRightIcon, ChevronDownIcon, PencilIcon } from '@lucide/vue'
import FormGrid from '@/components/ui/layout/FormGrid.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
/** Карточка партии: происхождение, качество, где лежит, операции, история. */
import { computed, onMounted, ref } from 'vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiButton from '@/components/ui/UiButton.vue'
import RefFieldHelp from '@/components/RefFieldHelp.vue'
import StockDocumentsTable from '@/components/stock/StockDocumentsTable.vue'
import StockTransferModal from '@/components/stock/StockTransferModal.vue'
import StockOutgoingModal from '@/components/stock/StockOutgoingModal.vue'
import StockProcessingModal from '@/components/stock/StockProcessingModal.vue'
import { formatSupabaseError } from '@/lib/formatSupabaseError'
import {
  formatTons,
  loadSimpleRef,
  loadStockBatch,
  loadStockDocumentsFor,
  parseDecimalInput,
  stockOriginLabel,
  updateStockBatch,
  type BatchPlacement,
  type SimpleRefRow,
  type StockBatch,
  type StockDocument,
  type StockOutgoingType,
  type StockPurpose,
} from '@/lib/stockLedger'

const props = defineProps<{ id: string }>()

const loading = ref(true)
const error = ref<string | null>(null)
const batch = ref<StockBatch | null>(null)
const placements = ref<BatchPlacement[]>([])
const documents = ref<StockDocument[]>([])
const purposes = ref<SimpleRefRow[]>([])

type Dialog = { kind: 'transfer' } | { kind: 'processing' } | { kind: 'outgoing'; type: StockOutgoingType } | { kind: 'edit' }
const dialog = ref<Dialog | null>(null)

async function load() {
  error.value = null
  try {
    const [b, docs, pu] = await Promise.all([
      loadStockBatch(props.id),
      loadStockDocumentsFor({ batchId: props.id }),
      loadSimpleRef('stock_batch_purposes'),
    ])
    purposes.value = pu
    batch.value = b?.batch ?? null
    placements.value = b?.placements ?? []
    documents.value = docs
  } catch (e) {
    error.value = formatSupabaseError(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function onDone() {
  dialog.value = null
  void load()
}

const QUALITY_LABELS: Record<string, string> = {
  moisture: 'Влажность, %',
  base_moisture: 'Базовая влажность, %',
  weed_impurity: 'Сорная примесь, %',
  grain_impurity: 'Зерновая примесь, %',
  nature: 'Натура, г/л',
  gluten: 'Клейковина, %',
  protein: 'Протеин, %',
  class: 'Класс',
}

/**
 * Известные показатели по-русски; перенесённые из старого учёта — как были. Пустые не показываем,
 * а старый ключ вроде «Влажность (%)» рядом с новым «Влажность, %» — только один раз.
 */
const qualityRows = computed(() => {
  const seen = new Set<string>()
  return Object.entries(batch.value?.quality ?? {})
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => ({ label: QUALITY_LABELS[k] ?? k, value: String(v) }))
    .filter((row) => {
      const key = row.label.toLowerCase().replace(/[^a-zа-яё]/g, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
})

const source = computed(() => {
  const b = batch.value
  if (!b) return ''
  if (b.origin === 'purchase') return b.supplierName ? `Закупка · ${b.supplierName}` : 'Закупка'
  if (b.origin === 'field') return b.fieldName ? `С поля · ${b.fieldName}` : 'С поля'
  return b.fieldName ? `${stockOriginLabel(b.origin)} · ${b.fieldName}` : stockOriginLabel(b.origin)
})

const OUTGOING: { type: StockOutgoingType; label: string }[] = [
  { type: 'sale', label: 'Продажа' },
  { type: 'seeding', label: 'На посев' },
  { type: 'consumption', label: 'Переработка / корм' },
  { type: 'writeoff', label: 'Списание' },
]

// Редактирование описательных полей
const edit = ref({ variety: '', harvestYear: '', purpose: 'food' as StockPurpose, fgis: '', comment: '', class: '', protein: '', gluten: '', nature: '' })
const editSaving = ref(false)
const editError = ref<string | null>(null)

function openEdit() {
  const b = batch.value
  if (!b) return
  const q = b.quality as Record<string, unknown>
  edit.value = {
    variety: b.variety ?? '',
    harvestYear: b.harvest_year != null ? String(b.harvest_year) : '',
    purpose: b.purpose,
    fgis: b.fgis_batch_number ?? '',
    comment: b.comment ?? '',
    class: q.class != null ? String(q.class) : '',
    protein: q.protein != null ? String(q.protein) : '',
    gluten: q.gluten != null ? String(q.gluten) : '',
    nature: q.nature != null ? String(q.nature) : '',
  }
  editError.value = null
  dialog.value = { kind: 'edit' }
}

async function saveEdit() {
  const b = batch.value
  if (!b) return
  editSaving.value = true
  editError.value = null
  const e = edit.value
  try {
    await updateStockBatch(b.id, {
      variety: e.variety.trim() || null,
      harvest_year: parseDecimalInput(e.harvestYear),
      purpose: e.purpose,
      fgis_batch_number: e.fgis.trim() || null,
      comment: e.comment.trim() || null,
      quality: {
        ...b.quality,
        class: e.class.trim() || null,
        protein: parseDecimalInput(e.protein),
        gluten: parseDecimalInput(e.gluten),
        nature: parseDecimalInput(e.nature),
      },
    })
    dialog.value = null
    await load()
  } catch (err) {
    editError.value = formatSupabaseError(err)
  } finally {
    editSaving.value = false
  }
}
</script>

<template>
  <section class="tw-scope flex flex-col gap-6">
    <div v-if="loading" class="grid gap-4">
      <Skeleton class="h-8 w-72" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>
    <Alert v-else-if="error && !batch" variant="destructive">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <Empty v-else-if="!batch" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyTitle>Партия не найдена</EmptyTitle>
        <EmptyDescription>Возможно, ссылка устарела. Вернитесь к списку партий.</EmptyDescription>
      </EmptyHeader>
    </Empty>

    <template v-else>
      <header class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="grid min-w-0 gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-xl font-semibold tabular-nums">{{ batch.code }}</h1>
            <UiBadge :tone="batch.tons > 0 ? 'success' : 'neutral'">{{ batch.tons > 0 ? 'С остатком' : 'Закрыта' }}</UiBadge>
          </div>
          <p class="text-sm text-muted-foreground">{{ batch.cropLabel }} · {{ source }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" type="button" :disabled="batch.tons <= 0" @click="dialog = { kind: 'transfer' }">
            <ArrowLeftRightIcon />
            Перемещение
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" type="button" :disabled="batch.tons <= 0">
                Операция
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem v-for="o in OUTGOING" :key="o.type" @select="dialog = { kind: 'outgoing', type: o.type }">{{ o.label }}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @select="dialog = { kind: 'processing' }">Подработка</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" type="button" @click="openEdit">
            <PencilIcon />
            Изменить
          </Button>
        </div>
      </header>

      <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <div class="grid gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Остаток</dt>
          <dd class="text-lg font-semibold tabular-nums">{{ formatTons(batch.tons) }}</dd>
        </div>
        <div class="grid gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Урожай</dt>
          <dd class="text-lg font-semibold tabular-nums">{{ batch.harvest_year ?? '—' }}</dd>
        </div>
        <div class="grid gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Назначение</dt>
          <dd class="text-sm font-medium">{{ batch.purposeLabel }}</dd>
        </div>
        <div class="grid gap-1 bg-card p-4">
          <dt class="text-xs text-muted-foreground">Сорт</dt>
          <dd class="text-sm font-medium">{{ batch.variety || '—' }}</dd>
        </div>
        <div class="col-span-2 grid gap-1 bg-card p-4 sm:col-span-2 lg:col-span-1">
          <dt class="text-xs text-muted-foreground">Партия во ФГИС</dt>
          <dd class="break-all text-sm font-medium tabular-nums">{{ batch.fgis_batch_number || '—' }}</dd>
        </div>
      </dl>

      <div class="grid gap-6 lg:grid-cols-2">
        <section class="grid content-start gap-3 rounded-xl border bg-card p-4 sm:p-6">
          <h2 class="text-sm font-medium">Где лежит</h2>
          <p v-if="!placements.length" class="text-sm text-muted-foreground">Партия полностью израсходована.</p>
          <ul v-else class="grid gap-2 text-sm">
            <li v-for="p in placements" :key="p.cellId" class="flex items-baseline justify-between gap-3">
              <RouterLink :to="{ name: 'warehouse-cell', params: { id: p.locationId } }" class="min-w-0 text-foreground no-underline underline-offset-4 hover:text-primary hover:underline">
                {{ p.locationName }}, {{ p.cellName }}
              </RouterLink>
              <span class="shrink-0 font-medium tabular-nums">{{ formatTons(p.tons) }}</span>
            </li>
          </ul>
        </section>
        <section class="grid content-start gap-3 rounded-xl border bg-card p-4 sm:p-6">
          <h2 class="text-sm font-medium">Качество</h2>
          <p v-if="!qualityRows.length" class="text-sm text-muted-foreground">Показатели не внесены.</p>
          <dl v-else class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <template v-for="q in qualityRows" :key="q.label">
              <dt class="text-muted-foreground">{{ q.label }}</dt>
              <dd class="tabular-nums">{{ q.value }}</dd>
            </template>
          </dl>
          <p v-if="batch.comment" class="whitespace-pre-line text-sm text-muted-foreground">{{ batch.comment }}</p>
        </section>
      </div>

      <section class="grid gap-3">
        <h2 class="text-base font-semibold">История партии</h2>
        <StockDocumentsTable :documents="documents" :scope-batch-id="batch.id" @changed="load" />
      </section>
    </template>

    <template v-if="batch && dialog">
      <StockTransferModal v-if="dialog.kind === 'transfer'" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
      <StockProcessingModal v-else-if="dialog.kind === 'processing'" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
      <StockOutgoingModal v-else-if="dialog.kind === 'outgoing'" :type="dialog.type" :batch-id="batch.id" @close="dialog = null" @done="onDone" />
      <UiModal
        v-else-if="dialog.kind === 'edit'"
        title="Данные партии"
        description="Культура и происхождение меняются только через документы."
        :max-width="560"
        :close-disabled="editSaving"
        @close="dialog = null"
      >
        <form id="batch-edit-form" class="tw-scope" @submit.prevent="saveEdit">
          <FormGrid :cols="2">
            <Alert v-if="editError" variant="destructive" class="sm:col-span-full">
              <AlertDescription>{{ editError }}</AlertDescription>
            </Alert>
            <FormField label="Сорт" for="be-variety">
              <Input id="be-variety" v-model.trim="edit.variety" />
            </FormField>
            <FormField label="Урожай года" for="be-year">
              <Input id="be-year" v-model.trim="edit.harvestYear" inputmode="numeric" placeholder="2026" />
            </FormField>
            <FormField label="Назначение">
              <template #label-actions>
                <RefFieldHelp text="Нужно своё назначение? Добавьте его в" :to="{ path: '/lands', query: { tab: 'storage-purposes' } }" link-label="Справочники хранения" />
              </template>
              <UiSelect v-model="edit.purpose" block aria-label="Назначение" :options="purposes.map((p) => ({ value: p.id, label: String(p.label), disabled: !p.active && p.id !== edit.purpose }))" />
            </FormField>
            <FormField label="Класс" for="be-class">
              <Input id="be-class" v-model.trim="edit.class" placeholder="Например, 3" />
            </FormField>
            <FormField label="Партия во ФГИС «Зерно», №" for="be-fgis" wide>
              <Input id="be-fgis" v-model.trim="edit.fgis" />
            </FormField>
            <div class="grid grid-cols-3 gap-4 sm:col-span-full">
              <FormField label="Протеин, %" for="be-protein">
                <Input id="be-protein" v-model.trim="edit.protein" inputmode="decimal" />
              </FormField>
              <FormField label="Клейковина, %" for="be-gluten">
                <Input id="be-gluten" v-model.trim="edit.gluten" inputmode="decimal" />
              </FormField>
              <FormField label="Натура, г/л" for="be-nature">
                <Input id="be-nature" v-model.trim="edit.nature" inputmode="decimal" />
              </FormField>
            </div>
            <FormField label="Комментарий" for="be-comment" wide>
              <Textarea id="be-comment" v-model.trim="edit.comment" rows="2" />
            </FormField>
          </FormGrid>
        </form>
        <template #actions>
          <UiButton :disabled="editSaving" @click="dialog = null">Отмена</UiButton>
          <UiButton variant="primary" type="submit" form="batch-edit-form" :disabled="editSaving">{{ editSaving ? 'Сохранение…' : 'Сохранить' }}</UiButton>
        </template>
      </UiModal>
    </template>
  </section>
</template>
