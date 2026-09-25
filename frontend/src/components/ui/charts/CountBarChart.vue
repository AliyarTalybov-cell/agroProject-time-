<script setup lang="ts">
/** Столбчатая диаграмма по категориям — Chart (Bar Default) из shadcn-vue. */
import { computed } from 'vue'
import { VisAxis, VisGroupedBar, VisXYContainer } from '@unovis/vue'
import { type ChartConfig, ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString } from '@/components/ui/shadcn/chart'

export interface BarRow {
  id: string
  label: string
  count: number
}

const props = withDefaults(defineProps<{ rows: BarRow[]; seriesLabel: string; color?: string }>(), { color: 'var(--chart-1)' })

const config = computed<ChartConfig>(() => ({ count: { label: props.seriesLabel, color: props.color } }))
const data = computed(() => props.rows.map((r, i) => ({ ...r, x: i })))
type D = BarRow & { x: number }
</script>

<template>
  <ChartContainer :config="config" class="max-h-[260px] w-full">
    <VisXYContainer :data="data" :margin="{ left: -16 }" :y-domain="[0, undefined]">
      <VisGroupedBar :x="(d: D) => d.x" :y="(d: D) => d.count" :color="color" :rounded-corners="6" :bar-padding="0.25" />
      <VisAxis
        type="x"
        :x="(d: D) => d.x"
        :tick-line="false"
        :domain-line="false"
        :grid-line="false"
        :tick-values="data.map((d) => d.x)"
        :tick-format="(i: number) => {
          const l = data[i]?.label ?? ''
          return l.length > 12 ? l.slice(0, 11) + '…' : l
        }"
      />
      <VisAxis type="y" :num-ticks="4" :tick-line="false" :domain-line="false" />
      <ChartTooltip />
      <ChartCrosshair :template="componentToString(config, ChartTooltipContent, { labelKey: 'label' })" color="#0000" />
    </VisXYContainer>
  </ChartContainer>
</template>
