<script setup lang="ts">
/**
 * Вкладки справочников раздела «Земли» (Настройки → Справочники).
 * Списки — в landRefsStore (их же использует реестр участков), правка — здесь.
 */
import { computed, ref, type Ref } from 'vue'
import { PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import RefList from '@/components/ui/RefList.vue'
import FormField from '@/components/ui/layout/FormField.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { Button } from '@/components/ui/shadcn/button'
import { Checkbox } from '@/components/ui/shadcn/checkbox'
import { Input } from '@/components/ui/shadcn/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs'
import LandsStockRefList from '@/components/lands/LandsStockRefList.vue'
import { askConfirm } from '@/composables/useConfirm'
import { isSupabaseConfigured } from '@/lib/supabase'
import {
  addCropByLabel,
  addLandActualUseOption,
  addLandCategory,
  addLandType,
  deleteCrop,
  deleteLandActualUseOption,
  deleteLandCategory,
  deleteLandType,
  updateCrop,
  updateLandActualUseOption,
  updateLandCategory,
  updateLandType,
  type CropRow,
} from '@/lib/landTypesAndCrops'
import {
  addLandCropRotationType,
  addLandMeliorationEventType,
  addLandMeliorationSubtype,
  addLandMeliorationType,
  addLandRightDocumentType,
  addLandRightHolder,
  addLandRightHolderType,
  addLandRightOwnershipForm,
  addLandRightType,
  deleteLandCropRotationType,
  deleteLandMeliorationEventType,
  deleteLandMeliorationSubtype,
  deleteLandMeliorationType,
  deleteLandRightDocumentType,
  deleteLandRightHolder,
  deleteLandRightHolderType,
  deleteLandRightOwnershipForm,
  deleteLandRightType,
  updateLandCropRotationType,
  updateLandMeliorationEventType,
  updateLandMeliorationSubtype,
  updateLandMeliorationType,
  updateLandRightDocumentType,
  updateLandRightHolder,
  updateLandRightHolderType,
  updateLandRightOwnershipForm,
  updateLandRightType,
  type LandRightHolderRow,
} from '@/lib/landsSupabase'
import {
  addStorageLocationStatus,
  addStorageLocationType,
  deleteStorageLocationStatus,
  deleteStorageLocationType,
  updateStorageLocationStatus,
  updateStorageLocationType,
} from '@/lib/storageRefsSupabase'
import { addFieldMunicipalityRef, deleteFieldMunicipalityRef, updateFieldMunicipalityRef } from '@/lib/fieldsSupabase'
import {
  addEquipmentConditionRef,
  addEquipmentTypeRef,
  deleteEquipmentConditionRef,
  deleteEquipmentTypeRef,
  updateEquipmentConditionRef,
  updateEquipmentTypeRef,
  type EquipmentConditionRefRow,
} from '@/lib/equipmentSupabase'
import {
  actualUseOptions,
  cropRotationTypeRefs,
  crops,
  equipmentConditionRefs,
  equipmentRefsTab,
  equipmentTypeRefs,
  fieldMunicipalityRefs,
  landCategories,
  landMeliorationEventTypes,
  landMeliorationSubtypes,
  landMeliorationTypes,
  landRefsTab,
  landRightDocumentTypes,
  landRightHolders,
  landRightHolderTypes,
  landRightOwnershipForms,
  landRightTypes,
  landTypes,
  meliorationRefsTab,
  rightsRefsTab,
  storageLocationStatusRefs,
  storageLocationTypeRefs,
  storageRefsTab,
} from './landRefsStore'
import { errorText, useRefCrud } from './useRefCrud'

defineProps<{
  tab: 'land-refs' | 'rights-refs' | 'crops-refs' | 'melioration-refs' | 'equipment-refs' | 'field-refs' | 'crop-rotation-refs' | 'storage-refs'
}>()

const busy = ref(false)
const error = ref<string | null>(null)
const state = { busy, error }

/** Простой справочник «название»: id + name, обычные add / update / delete. */
function simple<T extends { id: string; name: string }>(
  items: Ref<T[]>,
  promptTitle: string,
  what: string,
  api: { add: (name: string) => Promise<T>; update: (id: string, name: string) => Promise<unknown>; remove: (id: string) => Promise<unknown> },
) {
  return useRefCrud<T>(
    {
      items,
      promptTitle,
      errors: { add: `добавить ${what}`, update: `обновить ${what}`, remove: `удалить ${what}` },
      create: api.add,
      update: (row, name) => api.update(row.id, name),
      remove: (row) => api.remove(row.id),
    },
    state,
  )
}

// Земли
const landType = simple(landTypes, 'Новое название типа земли', 'тип земли', { add: addLandType, update: updateLandType, remove: deleteLandType })
const landCategory = simple(landCategories, 'Новое название категории земли', 'категорию земли', {
  add: addLandCategory,
  update: updateLandCategory,
  remove: deleteLandCategory,
})
const landUsage = simple(actualUseOptions, 'Новое значение использования участка', 'использование участка', {
  add: addLandActualUseOption,
  update: updateLandActualUseOption,
  remove: deleteLandActualUseOption,
})

// Культуры: название в поле label, при правке нужен и key
const crop = useRefCrud<CropRow>(
  {
    items: crops,
    field: 'label',
    promptTitle: 'Новое название культуры',
    errors: { add: 'добавить культуру', update: 'обновить культуру', remove: 'удалить культуру' },
    create: addCropByLabel,
    update: (row, label) => updateCrop(row.id, row.key, label),
    remove: (row) => deleteCrop(row.id),
  },
  state,
)

// Права
const ownershipForm = simple(landRightOwnershipForms, 'Новое название формы собственности', 'форму собственности', {
  add: addLandRightOwnershipForm,
  update: updateLandRightOwnershipForm,
  remove: deleteLandRightOwnershipForm,
})
const rightType = simple(landRightTypes, 'Новое название вида права', 'вид права', { add: addLandRightType, update: updateLandRightType, remove: deleteLandRightType })
const documentType = simple(landRightDocumentTypes, 'Новое название типа документа', 'тип документа', {
  add: addLandRightDocumentType,
  update: updateLandRightDocumentType,
  remove: deleteLandRightDocumentType,
})
const holderType = simple(landRightHolderTypes, 'Новое название вида правообладания', 'вид правообладания', {
  add: addLandRightHolderType,
  update: updateLandRightHolderType,
  remove: deleteLandRightHolderType,
})

// Мелиорация
const meliorationType = simple(landMeliorationTypes, 'Новое название типа мелиорации', 'тип мелиорации', {
  add: addLandMeliorationType,
  update: updateLandMeliorationType,
  remove: deleteLandMeliorationType,
})
const meliorationSubtype = simple(landMeliorationSubtypes, 'Новое название вида мелиорации', 'вид мелиорации', {
  add: addLandMeliorationSubtype,
  update: updateLandMeliorationSubtype,
  remove: deleteLandMeliorationSubtype,
})
const meliorationEventType = simple(landMeliorationEventTypes, 'Новое название типа мероприятия', 'тип мероприятия', {
  add: addLandMeliorationEventType,
  update: updateLandMeliorationEventType,
  remove: deleteLandMeliorationEventType,
})

// Поля и севооборот
const municipality = simple(fieldMunicipalityRefs, 'Новое название муниципального образования', 'муниципальное образование', {
  add: (name) => addFieldMunicipalityRef({ name }),
  update: (id, name) => updateFieldMunicipalityRef(id, { name }),
  remove: deleteFieldMunicipalityRef,
})
const cropRotationType = simple(cropRotationTypeRefs, 'Новое название типа севооборота', 'тип севооборота', {
  add: addLandCropRotationType,
  update: updateLandCropRotationType,
  remove: deleteLandCropRotationType,
})

// Хранение
const storageType = simple(storageLocationTypeRefs, 'Новое название типа места хранения', 'тип места хранения', {
  add: addStorageLocationType,
  update: updateStorageLocationType,
  remove: deleteStorageLocationType,
})
const newStatusMarksInactive = ref(false)
const storageStatus = simple(storageLocationStatusRefs, 'Новое название статуса', 'статус места хранения', {
  add: async (name) => {
    const row = await addStorageLocationStatus({ name, marks_inactive: newStatusMarksInactive.value })
    newStatusMarksInactive.value = false
    return row
  },
  update: (id, name) => updateStorageLocationStatus(id, { name }),
  remove: deleteStorageLocationStatus,
})

// Техника: у типа нужен латинский код, у состояния — уникальный код
function codeFromName(value: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const translit = value.trim().toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
  return translit.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
}

function uniqueConditionCode(name: string): string {
  const base = codeFromName(name) || `condition-${Date.now()}`
  const used = new Set(equipmentConditionRefs.value.map((x) => x.code))
  if (!used.has(base)) return base
  let idx = 2
  while (used.has(`${base}-${idx}`)) idx += 1
  return `${base}-${idx}`
}

const equipmentType = simple(equipmentTypeRefs, 'Новое название типа техники', 'тип техники', {
  add: (name) => addEquipmentTypeRef({ code: codeFromName(name) || `type-${Date.now()}`, name }),
  update: (id, name) => updateEquipmentTypeRef(id, { name }),
  remove: deleteEquipmentTypeRef,
})
const equipmentCondition = useRefCrud<EquipmentConditionRefRow>(
  {
    items: equipmentConditionRefs,
    key: 'code',
    promptTitle: 'Новое название состояния техники',
    errors: { add: 'добавить состояние техники', update: 'обновить состояние техники', remove: 'удалить состояние техники' },
    create: (name) => addEquipmentConditionRef({ code: uniqueConditionCode(name), name }),
    update: (row, name) => updateEquipmentConditionRef(row.code, { name }),
    remove: (row) => deleteEquipmentConditionRef(row.code),
  },
  state,
)
/** Пока своих состояний нет, показываем встроенные — как и в карточке техники. */
const DEFAULT_EQUIPMENT_CONDITIONS: EquipmentConditionRefRow[] = [
  { code: 'operational', name: 'Исправна', sort_order: 10, created_at: '' },
  { code: 'repair', name: 'В ремонте', sort_order: 20, created_at: '' },
  { code: 'decommissioned', name: 'Выведена', sort_order: 30, created_at: '' },
]
const equipmentConditionRows = computed(() =>
  (equipmentConditionRefs.value.length ? equipmentConditionRefs.value : DEFAULT_EQUIPMENT_CONDITIONS).map((r) => ({ ...r, id: r.code })),
)

// Правообладатели: своя форма с реквизитами
const holderForm = ref({ name: '', typeId: '', inn: '', kpp: '', ogrn: '' })
const editingHolderId = ref<string | null>(null)
const holderTypeName = computed(() => new Map(landRightHolderTypes.value.map((x) => [x.id, x.name])))

async function saveHolder() {
  const f = holderForm.value
  const name = f.name.trim()
  if (!name) return
  if (!isSupabaseConfigured()) {
    error.value = 'Справочники недоступны: нет подключения к базе.'
    return
  }
  const payload = { name, holder_type_id: f.typeId || null, inn: f.inn || null, kpp: f.kpp || null, ogrn: f.ogrn || null }
  busy.value = true
  error.value = null
  try {
    if (editingHolderId.value) {
      const id = editingHolderId.value
      await updateLandRightHolder(id, payload)
      landRightHolders.value = landRightHolders.value.map((x) => (x.id === id ? { ...x, ...payload } : x))
    } else {
      const row = await addLandRightHolder(payload)
      landRightHolders.value = [...landRightHolders.value, row]
    }
    editingHolderId.value = null
    holderForm.value = { name: '', typeId: '', inn: '', kpp: '', ogrn: '' }
  } catch (e) {
    error.value = errorText(e, 'Не удалось сохранить правообладателя')
  } finally {
    busy.value = false
  }
}

function editHolder(row: LandRightHolderRow) {
  editingHolderId.value = row.id
  holderForm.value = { name: row.name, typeId: row.holder_type_id ?? '', inn: row.inn ?? '', kpp: row.kpp ?? '', ogrn: row.ogrn ?? '' }
}

async function removeHolder(row: LandRightHolderRow) {
  if (!(await askConfirm(`Удалить «${row.name}»?`, 'Правообладатель будет удалён из справочника.'))) return
  busy.value = true
  error.value = null
  try {
    await deleteLandRightHolder(row.id)
    landRightHolders.value = landRightHolders.value.filter((x) => x.id !== row.id)
    if (editingHolderId.value === row.id) {
      editingHolderId.value = null
      holderForm.value = { name: '', typeId: '', inn: '', kpp: '', ogrn: '' }
    }
  } catch (e) {
    error.value = errorText(e, 'Не удалось удалить правообладателя')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <p v-if="error" class="lands-error">{{ error }}</p>

    <template v-if="tab === 'land-refs'">
      <Tabs :model-value="landRefsTab" class="mb-4">
        <TabsList class="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="land-types" @click="landRefsTab = 'land-types'">Типы земли</TabsTrigger>
          <TabsTrigger value="land-categories" @click="landRefsTab = 'land-categories'">Категории земли</TabsTrigger>
          <TabsTrigger value="land-usage" @click="landRefsTab = 'land-usage'">Использование участка</TabsTrigger>
        </TabsList>
      </Tabs>
      <RefList
        v-if="landRefsTab === 'land-types'"
        v-model="landType.draft.value"
        title="Типы земли"
        :items="landTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Пашня, Залежь"
        :busy="busy"
        empty-text="Пока нет типов земли."
        @add="landType.add"
        @edit="landType.edit"
        @remove="landType.remove"
      />
      <RefList
        v-else-if="landRefsTab === 'land-categories'"
        v-model="landCategory.draft.value"
        title="Категории земли"
        :items="landCategories"
        :get-label="(row) => row.name"
        placeholder="Например: Земли сельскохозяйственного назначения"
        :busy="busy"
        empty-text="Пока нет категорий земли."
        @add="landCategory.add"
        @edit="landCategory.edit"
        @remove="landCategory.remove"
      />
      <RefList
        v-else
        v-model="landUsage.draft.value"
        title="Использование участка"
        :items="actualUseOptions"
        :get-label="(row) => row.name"
        placeholder="Например: Используется"
        :busy="busy"
        empty-text="Пока нет вариантов использования участка."
        @add="landUsage.add"
        @edit="landUsage.edit"
        @remove="landUsage.remove"
      />
    </template>

    <RefList
      v-else-if="tab === 'crops-refs'"
      v-model="crop.draft.value"
      title="Справочники СХ культур"
      :items="crops"
      placeholder="Например: Пшеница"
      :busy="busy"
      empty-text="Пока нет культур."
      @add="crop.add"
      @edit="crop.edit"
      @remove="crop.remove"
    />

    <template v-else-if="tab === 'melioration-refs'">
      <Tabs :model-value="meliorationRefsTab" class="mb-4">
        <TabsList class="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="types" @click="meliorationRefsTab = 'types'">Типы мелиорации</TabsTrigger>
          <TabsTrigger value="subtypes" @click="meliorationRefsTab = 'subtypes'">Виды мелиорации</TabsTrigger>
          <TabsTrigger value="event-types" @click="meliorationRefsTab = 'event-types'">Типы мероприятий</TabsTrigger>
        </TabsList>
      </Tabs>
      <RefList
        v-if="meliorationRefsTab === 'types'"
        v-model="meliorationType.draft.value"
        title="Типы мелиорации"
        :items="landMeliorationTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Оросительная"
        :busy="busy"
        empty-text="Пока нет типов мелиорации."
        @add="meliorationType.add"
        @edit="meliorationType.edit"
        @remove="meliorationType.remove"
      />
      <RefList
        v-else-if="meliorationRefsTab === 'subtypes'"
        v-model="meliorationSubtype.draft.value"
        title="Виды мелиорации"
        :items="landMeliorationSubtypes"
        :get-label="(row) => row.name"
        placeholder="Например: Осушительная"
        :busy="busy"
        empty-text="Пока нет видов мелиорации."
        @add="meliorationSubtype.add"
        @edit="meliorationSubtype.edit"
        @remove="meliorationSubtype.remove"
      />
      <RefList
        v-else
        v-model="meliorationEventType.draft.value"
        title="Типы мероприятий"
        :items="landMeliorationEventTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Реконструкция"
        :busy="busy"
        empty-text="Пока нет типов мероприятий."
        @add="meliorationEventType.add"
        @edit="meliorationEventType.edit"
        @remove="meliorationEventType.remove"
      />
    </template>

    <template v-else-if="tab === 'equipment-refs'">
      <Tabs :model-value="equipmentRefsTab" class="mb-4">
        <TabsList class="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="types" @click="equipmentRefsTab = 'types'">Тип техники</TabsTrigger>
          <TabsTrigger value="conditions" @click="equipmentRefsTab = 'conditions'">Состояние техники</TabsTrigger>
        </TabsList>
      </Tabs>
      <RefList
        v-if="equipmentRefsTab === 'types'"
        v-model="equipmentType.draft.value"
        title="Тип техники"
        :items="equipmentTypeRefs"
        :get-label="(row) => row.name"
        placeholder="Например: Трактор"
        :busy="busy"
        empty-text="Пока нет типов техники."
        @add="equipmentType.add"
        @edit="equipmentType.edit"
        @remove="equipmentType.remove"
      />
      <RefList
        v-else
        v-model="equipmentCondition.draft.value"
        title="Состояние техники"
        :items="equipmentConditionRows"
        :get-label="(row) => row.name"
        placeholder="Например: Требует ТО"
        :busy="busy"
        @add="equipmentCondition.add"
        @edit="equipmentCondition.edit"
        @remove="equipmentCondition.remove"
      />
    </template>

    <template v-else-if="tab === 'field-refs'">
      <RefList
        v-model="municipality.draft.value"
        title="Муниципальные образования"
        :items="fieldMunicipalityRefs"
        :get-label="(row) => row.name"
        placeholder="Например: Новотроицкий сельсовет"
        :busy="busy"
        empty-text="Пока нет муниципальных образований."
        @add="municipality.add"
        @edit="municipality.edit"
        @remove="municipality.remove"
      />
    </template>

    <template v-else-if="tab === 'crop-rotation-refs'">
      <RefList
        v-model="cropRotationType.draft.value"
        title="Типы севооборота"
        :items="cropRotationTypeRefs"
        :get-label="(row) => row.name"
        placeholder="Например: Полевой"
        :busy="busy"
        empty-text="Пока нет типов севооборота."
        @add="cropRotationType.add"
        @edit="cropRotationType.edit"
        @remove="cropRotationType.remove"
      />
    </template>

    <template v-else-if="tab === 'storage-refs'">
      <Tabs :model-value="storageRefsTab" class="mb-4">
        <TabsList class="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="types" @click="storageRefsTab = 'types'">Типы мест хранения</TabsTrigger>
          <TabsTrigger value="statuses" @click="storageRefsTab = 'statuses'">Статусы мест хранения</TabsTrigger>
          <TabsTrigger value="writeoff-reasons" @click="storageRefsTab = 'writeoff-reasons'">Причины списания</TabsTrigger>
          <TabsTrigger value="consumption-targets" @click="storageRefsTab = 'consumption-targets'">Направления расхода</TabsTrigger>
          <TabsTrigger value="purposes" @click="storageRefsTab = 'purposes'">Назначение партий</TabsTrigger>
        </TabsList>
      </Tabs>
      <RefList
        v-if="storageRefsTab === 'types'"
        v-model="storageType.draft.value"
        title="Типы мест хранения"
        :items="storageLocationTypeRefs"
        :get-label="(row) => row.name"
        placeholder="Например: Элеватор"
        :busy="busy"
        empty-text="Пока нет типов мест хранения."
        @add="storageType.add"
        @edit="storageType.edit"
        @remove="storageType.remove"
      />
      <RefList
        v-else-if="storageRefsTab === 'statuses'"
        v-model="storageStatus.draft.value"
        title="Статусы мест хранения"
        hint="Статус с признаком «не используется» визуально выделяет неактивные места в реестре."
        :items="storageLocationStatusRefs"
        placeholder="Например: На ремонте"
        :busy="busy"
        empty-text="Пока нет статусов мест хранения."
        @add="storageStatus.add"
        @edit="storageStatus.edit"
        @remove="storageStatus.remove"
      >
        <template #add-extra>
          <label class="flex items-center gap-2 text-sm whitespace-nowrap">
            <Checkbox v-model="newStatusMarksInactive" />
            <span>Не используется (неактивно)</span>
          </label>
        </template>
        <template #label="{ item: row }">{{ row.name }}<template v-if="row.marks_inactive"> — не используется</template></template>
      </RefList>
      <LandsStockRefList
        v-else-if="storageRefsTab === 'writeoff-reasons'"
        table="stock_writeoff_reasons"
        title="Причины списания"
        hint="Выбираются при списании зерна со склада: порча, недостача, вредители…"
        placeholder="Например: Самосогревание"
      />
      <LandsStockRefList
        v-else-if="storageRefsTab === 'consumption-targets'"
        table="stock_consumption_targets"
        title="Направления расхода"
        hint="Куда уходит зерно при расходе на собственные нужды: на корм, на переработку, в свой цех…"
        placeholder="Например: На комбикорм"
      />
      <LandsStockRefList
        v-else-if="storageRefsTab === 'purposes'"
        table="stock_batch_purposes"
        title="Назначение партий"
        hint="Для чего партия: продовольственное, фуражное, семенное зерно, на экспорт…"
        placeholder="Например: Под договор"
      />
    </template>

    <template v-else>
      <Tabs :model-value="rightsRefsTab" class="mb-4">
        <TabsList class="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="ownership-forms" @click="rightsRefsTab = 'ownership-forms'">Формы собственности</TabsTrigger>
          <TabsTrigger value="right-types" @click="rightsRefsTab = 'right-types'">Виды прав</TabsTrigger>
          <TabsTrigger value="document-types" @click="rightsRefsTab = 'document-types'">Типы подтверждающих документов</TabsTrigger>
          <TabsTrigger value="holder-types" @click="rightsRefsTab = 'holder-types'">Виды правообладания</TabsTrigger>
          <TabsTrigger value="holders" @click="rightsRefsTab = 'holders'">Правообладатели</TabsTrigger>
        </TabsList>
      </Tabs>
      <RefList
        v-if="rightsRefsTab === 'ownership-forms'"
        v-model="ownershipForm.draft.value"
        title="Формы собственности"
        :items="landRightOwnershipForms"
        :get-label="(row) => row.name"
        placeholder="Например: Частная собственность"
        :busy="busy"
        @add="ownershipForm.add"
        @edit="ownershipForm.edit"
        @remove="ownershipForm.remove"
      />
      <RefList
        v-else-if="rightsRefsTab === 'right-types'"
        v-model="rightType.draft.value"
        title="Виды прав"
        :items="landRightTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Аренда земельных участков"
        :busy="busy"
        @add="rightType.add"
        @edit="rightType.edit"
        @remove="rightType.remove"
      />
      <RefList
        v-else-if="rightsRefsTab === 'document-types'"
        v-model="documentType.draft.value"
        title="Типы подтверждающих документов"
        :items="landRightDocumentTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Договор аренды"
        :busy="busy"
        @add="documentType.add"
        @edit="documentType.edit"
        @remove="documentType.remove"
      />
      <RefList
        v-else-if="rightsRefsTab === 'holder-types'"
        v-model="holderType.draft.value"
        title="Виды правообладания"
        :items="landRightHolderTypes"
        :get-label="(row) => row.name"
        placeholder="Например: Юридическое лицо"
        :busy="busy"
        @add="holderType.add"
        @edit="holderType.edit"
        @remove="holderType.remove"
      />

      <section v-else class="tw-scope grid gap-4">
        <h2 class="text-base font-semibold">Правообладатели</h2>
        <form class="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6" @submit.prevent="saveHolder">
          <FormField label="Наименование" for="holder-name" required>
            <Input id="holder-name" v-model="holderForm.name" type="text" />
          </FormField>
          <FormField label="Вид правообладания">
            <UiSelect v-model="holderForm.typeId" block aria-label="Вид правообладания" :options="[{ value: '', label: '—' }, ...landRightHolderTypes.map((t) => ({ value: t.id, label: String(t.name) }))]" />
          </FormField>
          <FormField label="ИНН" for="holder-inn">
            <Input id="holder-inn" v-model="holderForm.inn" type="text" inputmode="numeric" />
          </FormField>
          <FormField label="КПП" for="holder-kpp">
            <Input id="holder-kpp" v-model="holderForm.kpp" type="text" inputmode="numeric" />
          </FormField>
          <FormField label="ОГРН" for="holder-ogrn">
            <Input id="holder-ogrn" v-model="holderForm.ogrn" type="text" inputmode="numeric" />
          </FormField>
          <div class="flex items-end justify-end">
            <Button type="submit" :disabled="busy || !holderForm.name.trim()">
              <PlusIcon v-if="!editingHolderId" />
              {{ editingHolderId ? 'Сохранить' : 'Добавить' }}
            </Button>
          </div>
        </form>
        <ul v-if="landRightHolders.length" class="overflow-hidden rounded-xl border bg-card">
          <li v-for="row in landRightHolders" :key="row.id" class="flex items-center gap-2 border-b py-2 pr-2 pl-4 last:border-b-0">
            <div class="grid min-w-0 flex-1 gap-0.5">
              <span class="text-sm font-medium break-words">{{ row.name }}</span>
              <span class="text-xs text-muted-foreground tabular-nums">
                {{ holderTypeName.get(row.holder_type_id || '') || '—' }} · ИНН {{ row.inn || '—' }} · КПП {{ row.kpp || '—' }} · ОГРН {{ row.ogrn || '—' }}
              </span>
            </div>
            <Button variant="ghost" size="icon-sm" type="button" class="shrink-0 text-muted-foreground" :aria-label="`Изменить «${row.name}»`" @click="editHolder(row)">
              <PencilIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" type="button" class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" :aria-label="`Удалить «${row.name}»`" :disabled="busy" @click="removeHolder(row)">
              <Trash2Icon />
            </Button>
          </li>
        </ul>
        <p v-else class="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Правообладателей пока нет.</p>
      </section>
    </template>
  </div>
</template>
