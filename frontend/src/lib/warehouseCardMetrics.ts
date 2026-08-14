/**
 * Метрики карточки «Склады» по месту хранения.
 * Сейчас — заглушка: таблицы поступлений / партий ещё нет.
 * Позже: подставить данные из Supabase и маппить fillState по правилам бизнеса.
 */
export type BatchFillState = 'empty' | 'filling' | 'formed'

export type WarehouseCardMetrics = {
  fillState: BatchFillState
  occupancyPercent: number
  totalMassTons: number
  /** Масса, доступная для перемещения (без резерва и брака) */
  availableForTransferTons: number
  reservedTons: number
  spoiledTons: number
  cropLabel: string | null
  lastOperationAt: string | null
  lastOperationLabel?: string | null
}

/** Код из справочника `storage_fill_statuses`; неизвестные и пользовательские без кода — как «пусто» для цвета/фильтра по системным кодам. */
export function fillBatchStateFromCode(code: string | null | undefined): BatchFillState {
  if (code === 'filling' || code === 'formed') return code
  return 'empty'
}

export function placeholderWarehouseMetrics(): WarehouseCardMetrics {
  return {
    fillState: 'empty',
    occupancyPercent: 0,
    totalMassTons: 0,
    availableForTransferTons: 0,
    reservedTons: 0,
    spoiledTons: 0,
    cropLabel: null,
    lastOperationAt: null,
  }
}
