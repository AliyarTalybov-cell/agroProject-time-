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
