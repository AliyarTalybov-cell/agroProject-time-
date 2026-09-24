import { computed, ref } from 'vue'
import {
  loadCounterparties,
  loadFieldOptions,
  loadGrainCrops,
  loadPlacements,
  loadStockBatches,
  loadWarehousesOverview,
  loadWriteoffReasons,
  type BatchPlacement,
  type Counterparty,
  type FieldOption,
  type GrainCrop,
  type StockBatch,
  type WarehouseOverview,
  type WriteoffReason,
} from '@/lib/stockLedger'

/**
 * Справочники для форм складских операций. Загружаются один раз на форму,
 * `reload()` — после проведения документа, чтобы остатки в выпадающих
 * списках были свежими.
 */
export function useStockRefs() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const crops = ref<GrainCrop[]>([])
  const fields = ref<FieldOption[]>([])
  const warehouses = ref<WarehouseOverview[]>([])
  const counterparties = ref<Counterparty[]>([])
  const reasons = ref<WriteoffReason[]>([])
  const batches = ref<StockBatch[]>([])
  const placements = ref<BatchPlacement[]>([])

  async function reload() {
    loading.value = true
    error.value = null
    try {
      const [c, f, w, cp, r, b] = await Promise.all([
        loadGrainCrops(),
        loadFieldOptions(),
        loadWarehousesOverview(),
        loadCounterparties(),
        loadWriteoffReasons(),
        loadStockBatches(),
      ])
      crops.value = c
      fields.value = f
      warehouses.value = w
      counterparties.value = cp.filter((x) => x.active)
      reasons.value = r
      batches.value = b.batches
      placements.value = b.placements
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить справочники'
    } finally {
      loading.value = false
    }
  }

  async function reloadPlacements() {
    placements.value = await loadPlacements()
  }

  /** Все ячейки всех складов — для выбора «куда». */
  const cellOptions = computed(() =>
    warehouses.value.flatMap((w) =>
      w.cells
        .filter((c) => c.active)
        .map((c) => ({
          id: c.id,
          locationId: w.id,
          label: `${w.name} — ${c.name}`,
          cropLabel: c.cropLabel,
          tons: c.tons,
          capacity: c.capacity_tons,
        })),
    ),
  )

  const batchById = computed(() => new Map(batches.value.map((b) => [b.id, b])))

  /** Что где лежит — для выбора «откуда»: партия в ячейке с остатком. */
  const placementOptions = computed(() =>
    placements.value
      .map((p) => {
        const b = batchById.value.get(p.batchId)
        return {
          key: `${p.batchId}|${p.cellId}`,
          batchId: p.batchId,
          cellId: p.cellId,
          locationId: p.locationId,
          tons: p.tons,
          available: Math.max(0, p.tons),
          cropKey: b?.crop_key ?? '',
          label: `${b?.code ?? ''} · ${b?.cropLabel ?? ''} — ${p.locationName}, ${p.cellName}`,
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
  )

  const buyers = computed(() => counterparties.value.filter((c) => c.kind !== 'supplier'))
  const suppliers = computed(() => counterparties.value.filter((c) => c.kind !== 'buyer'))

  return {
    loading,
    error,
    crops,
    fields,
    warehouses,
    counterparties,
    reasons,
    batches,
    placements,
    cellOptions,
    placementOptions,
    batchById,
    buyers,
    suppliers,
    reload,
    reloadPlacements,
  }
}

/** Локальное «сейчас» для input type="datetime-local". */
export function nowLocalInput(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/**
 * Значение datetime-local → ISO с часовым поясом пользователя. Поле хранит
 * время до минуты; если его не меняли (или поставили текущую минуту), берём
 * точное «сейчас» — иначе документы одной минуты встают в журнале не по порядку.
 */
export function localInputToIso(v: string): string {
  if (!v || v === nowLocalInput()) return new Date().toISOString()
  return new Date(v).toISOString()
}
