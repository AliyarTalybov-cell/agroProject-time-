/** Типы форм окон раздела земель. Вынесены из компонентов: `<script setup>` не
 *  разрешает собственные экспорты, а страница и окна должны видеть один тип. */

/** Поля формы севооборота — тот же набор, что был у `cropRotationForm` на LandsPage. */
export type CropRotationForm = {
  fieldId: string
  season: string
  rotationType: string
  cropKey: string
  seedMaterialName: string
  areaForCropsHa: number | null
  areaWithImprovedProductsHa: number | null
  areaForOrganicHa: number | null
  areaForSelectionSeedHa: number | null
  producedProductsInfo: string
  producedCropMassTons: number | null
}

/** Поле участка в выпадающем списке — только то, что рисуется. */
export type CropRotationFieldOption = {
  id: string
  number?: string | number | null
  name?: string | null
}

/** Поля формы объекта недвижимости — набор из `realEstateForm` на LandsPage. */
export type RealEstateForm = {
  fieldId: string
  cadastralNumber: string
  name: string
  locationDescription: string
  areaSqm: number | null
  permittedUse: string
  purpose: string
  address: string
  depthM: number | null
  heightM: number | null
  lengthM: number | null
  volumeM3: number | null
  burialDepthM: number | null
  developmentPlan: string
  floors: string
  undergroundFloors: string
}

/** Поля формы мелиорации — набор из `meliorationForm` на LandsPage. */
export type MeliorationForm = {
  fieldId: string
  cropKey: string
  areaHa: number | null
  meliorationType: string
  meliorationSubtype: string
  descriptionLocation: string
  cadastralNumber: string
  commissionedAt: string
  forestCharacteristics: string
  forestYearCreated: number | null
  reconstructionInfo: string
  eventType: string
  eventDate: string
  projectApproval: string
}

/** Вкладка раздела мелиорации: от неё зависит набор полей в окне. */
export type MeliorationTab = 'systems' | 'forest' | 'events'
