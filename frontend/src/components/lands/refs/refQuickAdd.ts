/**
 * Быстрое добавление значения справочника прямо из формы (подсказка «?»
 * у поля). Значение пишется в базу и дописывается в общий список
 * landRefsStore, поэтому сразу появляется во всех выпадающих списках.
 *
 * Если такое название уже есть (без учёта регистра), возвращается
 * существующая строка — дубль не создаётся.
 */
import { findOrCreate } from '@/lib/refFindOrCreate'
import { addCropByLabel, addLandActualUseOption, addLandCategory, addLandType } from '@/lib/landTypesAndCrops'
import {
  addLandCropRotationType,
  addLandMeliorationEventType,
  addLandMeliorationSubtype,
  addLandMeliorationType,
  addLandRightDocumentType,
  addLandRightHolderType,
  addLandRightOwnershipForm,
  addLandRightType,
} from '@/lib/landsSupabase'
import { addStorageLocationStatus, addStorageLocationType } from '@/lib/storageRefsSupabase'
import { addFieldMunicipalityRef } from '@/lib/fieldsSupabase'
import { addEquipmentConditionRef, addEquipmentTypeRef } from '@/lib/equipmentSupabase'
import {
  actualUseOptions,
  cropRotationTypeRefs,
  crops,
  equipmentConditionRefs,
  equipmentTypeRefs,
  fieldMunicipalityRefs,
  landCategories,
  landMeliorationEventTypes,
  landMeliorationSubtypes,
  landMeliorationTypes,
  landRightDocumentTypes,
  landRightHolderTypes,
  landRightOwnershipForms,
  landRightTypes,
  landTypes,
  storageLocationStatusRefs,
  storageLocationTypeRefs,
} from './landRefsStore'


/** Латинский код из русского названия: «Трактор колёсный» → «traktor-kolesnyy». */
export function codeFromName(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const translit = value.trim().toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
  return translit.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
}

/** Уникальный среди состояний техники код. */
export function uniqueConditionCode(name: string): string {
  const base = codeFromName(name) || `condition-${Date.now()}`
  const used = new Set(equipmentConditionRefs.value.map((x) => x.code))
  if (!used.has(base)) return base
  let idx = 2
  while (used.has(`${base}-${idx}`)) idx += 1
  return `${base}-${idx}`
}

export { findOrCreate }

const byName = (row: { name: string }) => row.name

export const quickAdd = {
  landType: (name: string) => findOrCreate(landTypes, name, byName, addLandType),
  landCategory: (name: string) => findOrCreate(landCategories, name, byName, addLandCategory),
  landUsage: (name: string) => findOrCreate(actualUseOptions, name, byName, addLandActualUseOption),
  crop: (name: string) => findOrCreate(crops, name, (r) => r.label, addCropByLabel),
  ownershipForm: (name: string) => findOrCreate(landRightOwnershipForms, name, byName, addLandRightOwnershipForm),
  rightType: (name: string) => findOrCreate(landRightTypes, name, byName, addLandRightType),
  documentType: (name: string) => findOrCreate(landRightDocumentTypes, name, byName, addLandRightDocumentType),
  holderType: (name: string) => findOrCreate(landRightHolderTypes, name, byName, addLandRightHolderType),
  meliorationType: (name: string) => findOrCreate(landMeliorationTypes, name, byName, addLandMeliorationType),
  meliorationSubtype: (name: string) => findOrCreate(landMeliorationSubtypes, name, byName, addLandMeliorationSubtype),
  meliorationEventType: (name: string) => findOrCreate(landMeliorationEventTypes, name, byName, addLandMeliorationEventType),
  cropRotationType: (name: string) => findOrCreate(cropRotationTypeRefs, name, byName, addLandCropRotationType),
  municipality: (name: string) => findOrCreate(fieldMunicipalityRefs, name, byName, (n) => addFieldMunicipalityRef({ name: n })),
  equipmentType: (name: string) =>
    findOrCreate(equipmentTypeRefs, name, byName, (n) => addEquipmentTypeRef({ code: codeFromName(n) || `type-${Date.now()}`, name: n })),
  equipmentCondition: (name: string) =>
    findOrCreate(equipmentConditionRefs, name, byName, (n) => addEquipmentConditionRef({ code: uniqueConditionCode(n), name: n })),
  storageType: (name: string) => findOrCreate(storageLocationTypeRefs, name, byName, addStorageLocationType),
  storageStatus: (name: string) => findOrCreate(storageLocationStatusRefs, name, byName, (n) => addStorageLocationStatus({ name: n })),
}
