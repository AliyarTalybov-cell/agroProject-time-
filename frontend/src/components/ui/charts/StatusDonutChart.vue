<script setup lang="ts">
/** Кольцевая диаграмма с итогом в центре — Chart (Pie Donut Text) из shadcn-vue. */
import { computed } from 'vue'
import { Donut } from '@unovis/ts'
import { VisDonut, VisSingleContainer } from '@unovis/vue'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, componentToString } from '@/components/ui/shadcn/chart'

export interface DonutSlice {
  key: string
  label: string
  count: number
  color: string
}

const props = defineProps<{ slices: DonutSlice[]; total: number; totalLabel: string }>()

const config = computed<ChartConfig>(() =>
  Object.fromEntries(props.slices.map((s) => [s.key, { label: s.label, color: s.color }])),
)
</script>

<template>
  <ChartContainer
    :config="config"
    class="mx-auto aspect-square max-h-[220px]"
    :style="{
      '--vis-donut-central-label-font-size': 'var(--text-3xl)',
      '--vis-donut-central-label-font-weight': 'var(--font-weight-bold)',
      '--vis-donut-central-label-text-color': 'var(--foreground)',
      '--vis-donut-central-sub-label-text-color': 'var(--muted-foreground)',
    }"
  >
    <VisSingleContainer :data="slices" :margin="{ top: 16, bottom: 16 }">
      <VisDonut
        :value="(d: DonutSlice) => d.count"
        :color="(d: DonutSlice) => d.color"
        :arc-width="28"
        :pad-angle="0.02"
        :corner-radius="4"
        :central-label="String(total)"
        :central-sub-label="totalLabel"
      />
      <ChartTooltip :triggers="{ [Donut.selectors.segment]: componentToString(config, ChartTooltipContent, { hideLabel: false, nameKey: 'key' })! }" />
    </VisSingleContainer>
  </ChartContainer>
</template>
