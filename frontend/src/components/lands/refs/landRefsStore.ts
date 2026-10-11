/**
 * Справочники раздела «Земли»: списки нужны и реестру (выпадающие списки в
 * карточке участка), и вкладкам справочников, поэтому живут здесь, а не в
 * странице. Загружает их LandsPage (reloadAll и ленивые загрузки по вкладкам),
 * правит — LandsRefsPanel.
 */
import { ref } from 'vue'
import type { CropRow, LandActualUseOptionRow, LandCategoryRow } from '@/lib/landTypesAndCrops'
import type { LandCropRotationTypeRefRow, LandRightHolderRow, LandRightRefRow, LandTypeRow } from '@/lib/landsSupabase'
import type { StorageFillStatusRow, StorageLocationStatusRow, StorageLocationTypeRow } from '@/lib/storageRefsSupabase'
import type { FieldMunicipalityRefRow } from '@/lib/fieldsSupabase'
import type { EquipmentConditionRefRow, EquipmentTypeRefRow } from '@/lib/equipmentSupabase'

export const landTypes = ref<LandTypeRow[]>([])
export const landCategories = ref<LandCategoryRow[]>([])
export const actualUseOptions = ref<LandActualUseOptionRow[]>([])
export const crops = ref<CropRow[]>([])
export const landRightOwnershipForms = ref<LandRightRefRow[]>([])
export const landRightTypes = ref<LandRightRefRow[]>([])
export const landRightDocumentTypes = ref<LandRightRefRow[]>([])
export const landRightHolderTypes = ref<LandRightRefRow[]>([])
export const landRightHolders = ref<LandRightHolderRow[]>([])
export const landMeliorationTypes = ref<LandRightRefRow[]>([])
export const landMeliorationSubtypes = ref<LandRightRefRow[]>([])
export const landMeliorationEventTypes = ref<LandRightRefRow[]>([])
export const equipmentTypeRefs = ref<EquipmentTypeRefRow[]>([])
export const equipmentConditionRefs = ref<EquipmentConditionRefRow[]>([])
export const fieldMunicipalityRefs = ref<FieldMunicipalityRefRow[]>([])
export const cropRotationTypeRefs = ref<LandCropRotationTypeRefRow[]>([])
export const storageLocationTypeRefs = ref<StorageLocationTypeRow[]>([])
export const storageLocationStatusRefs = ref<StorageLocationStatusRow[]>([])
export const storageFillStatusRefs = ref<StorageFillStatusRow[]>([])

/** Подвкладки справочников: их открывает и ссылка вида /lands?tab=storage-purposes. */
export const landRefsTab = ref<'land-types' | 'land-categories' | 'land-usage'>('land-types')
export const rightsRefsTab = ref<'ownership-forms' | 'right-types' | 'document-types' | 'holder-types' | 'holders'>('ownership-forms')
export const meliorationRefsTab = ref<'types' | 'subtypes' | 'event-types'>('types')
export const equipmentRefsTab = ref<'types' | 'conditions'>('types')
export const storageRefsTab = ref<'types' | 'statuses' | 'writeoff-reasons' | 'consumption-targets' | 'purposes'>('types')
