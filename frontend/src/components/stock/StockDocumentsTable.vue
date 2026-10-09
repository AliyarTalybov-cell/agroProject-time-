<script setup lang="ts">
import { Button } from '@/components/ui/shadcn/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@/components/ui/shadcn/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/shadcn/table'
import { ChevronDownIcon, ScrollTextIcon } from '@lucide/vue'
import UiBadge, { type UiBadgeTone } from '@/components/ui/UiBadge.vue'
/**
 * Таблица складских документов: журнал операций, история склада и партии.
 * Строка раскрывается — движения по партиям и ячейкам, транспорт, документы,
 * веса и качество. Руководитель может отменить проведённый документ (сторно).
 *
 * `scopeLocationId` / `scopeBatchId` — показывать в колонке массы только
 * движения этого склада / этой партии (перемещение внутри склада даёт ноль).
 */
import { computed, ref } from 'vue'
import { useAuth } from '@/stores/auth'
import StockCancelModal from './StockCancelModal.vue'
import {
  consumptionTargetLabel,
  formatRub,
  formatTons,
  stockDocTypeLabel,
  type StockDocument,
} from '@/lib/stockLedger'

const props = defineProps<{
  documents: StockDocument[]
  scopeLocationId?: string | null
  scopeBatchId?: string | null
  emptyText?: string
}>()
const emit = defineEmits<{ changed: [] }>()

const auth = useAuth()
const isManager = computed(() => auth.userRole.value === 'manager')
const expanded = ref<string | null>(null)
const cancelling = ref<StockDocument | null>(null)

const DOC_TONE: Record<string, UiBadgeTone> = {
  opening: 'neutral',
  intake: 'success',
  processing: 'warning',
  transfer: 'info',
  sale: 'primary',
  seeding: 'success',
  consumption: 'warning',
  writeoff: 'danger',
  inventory: 'neutral',
  storno: 'danger',
}

function scopedMovements(d: StockDocument) {
  return d.movements.filter(
    (m) =>
      (!props.scopeLocationId || m.locationId === props.scopeLocationId) &&
      (!props.scopeBatchId || m.batch_id === props.scopeBatchId),
  )
}

function delta(d: StockDocument): number {
  return Number(scopedMovements(d).reduce((s, m) => s + m.delta_tons, 0).toFixed(3))
}

/** Для перемещения важно «сколько перевезли», а не сумма ± (она ноль или потери). */
function movedTons(d: StockDocument): number {
  return Number(d.movements.filter((m) => m.delta_tons < 0).reduce((s, m) => s - m.delta_tons, 0).toFixed(3))
}

function party(d: StockDocument): string {
  if (d.counterpartyName) return d.counterpartyName
  if (d.fieldName) return d.fieldName
  if (d.reasonName) return d.reasonName
  if (d.consumption_target) return d.consumptionTargetName ?? consumptionTargetLabel(d.consumption_target)
  if (d.doc_type === 'transfer') {
    const from = d.movements.find((m) => m.delta_tons < 0)
    const to = d.movements.find((m) => m.delta_tons > 0)
    return from && to ? `${from.locationName}, ${from.cellName} → ${to.locationName}, ${to.cellName}` : ''
  }
  return ''
}

function batchList(d: StockDocument): string[] {
  return Array.from(new Set(scopedMovements(d).map((m) => `${m.batchCode} · ${m.cropLabel}`)))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const QUALITY_LABELS: Record<string, string> = {
  moisture: 'Влажность, %',
  base_moisture: 'Базовая влажность, %',
  weed_impurity: 'Сорная примесь, %',
  grain_impurity: 'Зерновая примесь, %',
  nature: 'Натура, г/л',
  gluten: 'Клейковина, %',
  protein: 'Протеин, %',
}
const WEIGHT_LABELS: Record<string, string> = {
  gross: 'Брутто, т',
  tare: 'Тара, т',
  grain_mass: 'Масса зерна, т',
  dry_mass: 'После сушки, т',
  impurity_loss: 'Потери на примеси, т',
  net: 'Зачётный вес, т',
  buyer_net: 'Вес у покупателя, т',
  before: 'До подработки, т',
  after: 'После подработки, т',
}

function details(d: StockDocument): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const push = (label: string, v: unknown) => {
    if (v != null && v !== '') out.push({ label, value: String(v) })
  }
  push('Машина', d.vehicle_plate)
  push('Водитель', d.driver_name)
  push('ТТН / накладная', d.waybill_number)
  push('СДИЗ', d.sdiz_number)
  push('Акт', d.act_number)
  if (d.price_per_ton != null) push('Цена за тонну', formatRub(d.price_per_ton))
  for (const [k, v] of Object.entries(d.weights)) push(WEIGHT_LABELS[k] ?? k, v)
  for (const [k, v] of Object.entries(d.quality)) push(QUALITY_LABELS[k] ?? k, v)
  push('Комментарий', d.comment)
  if (d.status === 'cancelled') push('Отменён', d.cancel_reason)
  push('Провёл', d.createdByName)
  return out
}

function canCancel(d: StockDocument): boolean {
  return isManager.value && d.status === 'posted' && d.doc_type !== 'storno' && d.doc_type !== 'opening'
}

function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id
}
</script>

<template>
  <div class="tw-scope">
    <Empty v-if="!documents.length" class="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon"><ScrollTextIcon /></EmptyMedia>
        <EmptyDescription>{{ emptyText ?? 'Операций пока нет.' }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div v-else class="sm:overflow-hidden sm:rounded-xl sm:border sm:bg-card">
      <Table v-card-table class="min-w-[56rem]">
        <TableHeader class="bg-muted/50">
          <TableRow>
            <TableHead class="pl-4">Дата</TableHead>
            <TableHead>Операция</TableHead>
            <TableHead>Партии</TableHead>
            <TableHead>Контрагент / поле / куда</TableHead>
            <TableHead class="text-right">Масса</TableHead>
            <TableHead class="text-right">Сумма</TableHead>
            <TableHead class="w-px pr-4"><span class="sr-only">Действия</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="d in documents" :key="d.id">
            <TableRow class="cursor-pointer" :class="d.status === 'cancelled' ? 'text-muted-foreground' : ''" :aria-expanded="expanded === d.id" @click="toggle(d.id)">
              <TableCell class="pl-4 tabular-nums">
                <span class="font-medium" :class="d.status === 'cancelled' ? 'line-through' : 'text-foreground'">{{ formatDate(d.doc_date) }}</span>
                <span class="block text-xs text-muted-foreground">№ {{ d.number }}</span>
              </TableCell>
              <TableCell>
                <UiBadge :tone="d.status === 'cancelled' ? 'neutral' : DOC_TONE[d.doc_type] ?? 'neutral'">{{ stockDocTypeLabel(d.doc_type) }}</UiBadge>
                <span v-if="d.status === 'cancelled'" class="block text-xs">отменён</span>
              </TableCell>
              <TableCell class="max-w-64 whitespace-normal">
                <span class="line-clamp-2">{{ batchList(d)[0] ?? '—' }}</span>
                <span v-if="batchList(d).length > 1" class="block text-xs text-muted-foreground">и ещё {{ batchList(d).length - 1 }}</span>
              </TableCell>
              <TableCell class="max-w-64 whitespace-normal">{{ party(d) || '—' }}</TableCell>
              <TableCell class="text-right font-medium tabular-nums" :class="d.status === 'cancelled' ? 'line-through' : ''">
                <template v-if="d.doc_type === 'transfer' && (!scopeLocationId || delta(d) === 0)">{{ formatTons(movedTons(d)) }}</template>
                <span v-else :class="d.status === 'cancelled' ? '' : delta(d) > 0 ? 'text-emerald-700 dark:text-emerald-400' : delta(d) < 0 ? 'text-destructive' : ''">
                  {{ delta(d) > 0 ? '+' : '' }}{{ formatTons(delta(d), 3) }}
                </span>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ d.amount != null ? formatRub(d.amount) : '—' }}</TableCell>
              <TableCell class="pr-4" @click.stop>
                <div class="flex items-center justify-end gap-1">
                  <Button v-if="canCancel(d)" variant="outline" size="sm" type="button" class="hover:text-destructive" @click="cancelling = d">Отменить</Button>
                  <Button variant="ghost" size="icon-sm" type="button" :aria-label="expanded === d.id ? 'Свернуть подробности' : 'Показать подробности'" @click="toggle(d.id)">
                    <ChevronDownIcon class="transition-transform" :class="expanded === d.id ? 'rotate-180' : ''" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="expanded === d.id" class="bg-muted/30 hover:bg-muted/30">
              <TableCell colspan="7" class="whitespace-normal px-4 py-4">
                <div class="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                  <section class="grid content-start gap-2">
                    <h4 class="text-sm font-medium">Движения</h4>
                    <ul class="grid gap-1.5 text-sm">
                      <li v-for="m in d.movements" :key="m.id" class="flex gap-3">
                        <span class="w-20 shrink-0 text-right font-medium tabular-nums" :class="m.delta_tons > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'">
                          {{ m.delta_tons > 0 ? '+' : '' }}{{ formatTons(m.delta_tons, 3) }}
                        </span>
                        <span class="min-w-0">{{ m.batchCode }} · {{ m.cropLabel }} — {{ m.locationName }}, {{ m.cellName }}</span>
                      </li>
                    </ul>
                  </section>
                  <dl v-if="details(d).length" class="grid content-start grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                    <template v-for="item in details(d)" :key="item.label">
                      <dt class="text-muted-foreground">{{ item.label }}</dt>
                      <dd class="break-words">{{ item.value }}</dd>
                    </template>
                  </dl>
                </div>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <StockCancelModal
      v-if="cancelling"
      :document="cancelling"
      @close="cancelling = null"
      @done="cancelling = null; emit('changed')"
    />
  </div>
</template>
