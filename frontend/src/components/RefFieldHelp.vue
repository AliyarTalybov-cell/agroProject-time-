<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { RouteLocationRaw } from 'vue-router'

withDefaults(
  defineProps<{
    text: string
    to: RouteLocationRaw
    linkLabel?: string
  }>(),
  {
    linkLabel: 'Открыть раздел',
  },
)

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)

const pos = ref({ top: 0, left: 0, maxW: 360 })

let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide() {
  clearHideTimer()
  hideTimer = setTimeout(() => {
    open.value = false
  }, 200)
}

function cancelHide() {
  clearHideTimer()
}

const tooltipStyle = computed(() => ({
  top: `${pos.value.top}px`,
  left: `${pos.value.left}px`,
  maxWidth: `${pos.value.maxW}px`,
}))

function updatePosition() {
  const trigger = triggerRef.value
  if (!trigger) return
  const r = trigger.getBoundingClientRect()
  const margin = 8
  const gap = 6
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.min(360, vw - margin * 2)

  let left = r.left
  let top = r.bottom + gap
  const estW = Math.min(280, maxW)
  left = Math.max(margin, Math.min(left, vw - margin - estW))

  pos.value = { top, left, maxW }

  nextTick(() => {
    const tip = tooltipRef.value
    if (!tip) return
    const br = tip.getBoundingClientRect()
    let nextLeft = left
    let nextTop = top

    if (br.right > vw - margin) {
      nextLeft = Math.max(margin, vw - margin - br.width)
    }
    if (br.left < margin) {
      nextLeft = margin
    }
    if (br.bottom > vh - margin) {
      nextTop = Math.max(margin, r.top - gap - br.height)
    }
    pos.value = { top: nextTop, left: nextLeft, maxW }
  })
}

function onTriggerFocusOut(e: FocusEvent) {
  const tip = tooltipRef.value
  const next = e.relatedTarget as Node | null
  if (tip && next && tip.contains(next)) return
  scheduleHide()
}

function onTooltipFocusOut(e: FocusEvent) {
  const trig = triggerRef.value
  const tip = tooltipRef.value
  const next = e.relatedTarget as Node | null
  if (trig && next && trig.contains(next)) return
  if (tip && next && tip.contains(next)) return
  scheduleHide()
}

function show() {
  cancelHide()
  open.value = true
  void nextTick(() => updatePosition())
}

function onScrollOrResize() {
  if (open.value) updatePosition()
}

watch(open, (v) => {
  if (v) {
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
  } else {
    window.removeEventListener('scroll', onScrollOrResize, true)
    window.removeEventListener('resize', onScrollOrResize)
  }
})

onUnmounted(() => {
  clearHideTimer()
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})
</script>

<template>
  <span
    ref="triggerRef"
    class="ref-help"
    tabindex="0"
    aria-label="Подсказка по справочнику"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="onTriggerFocusOut"
  >
    <span class="ref-help-icon">?</span>
  </span>
  <Teleport to="body">
    <div
      v-show="open"
      ref="tooltipRef"
      class="ref-help-tooltip"
      role="tooltip"
      :style="tooltipStyle"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
      @focusin="cancelHide"
      @focusout="onTooltipFocusOut"
    >
      <span class="ref-help-text"
        >{{ text }} <RouterLink :to="to" class="ref-help-link">{{ linkLabel }}</RouterLink></span
      >
    </div>
  </Teleport>
</template>

<style scoped>
.ref-help {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  vertical-align: middle;
  outline: none;
}

.ref-help-icon {
  width: auto;
  height: auto;
  border: none;
  color: var(--text-secondary);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: help;
}

.ref-help-tooltip {
  position: fixed;
  z-index: 20000;
  min-width: min(220px, calc(100vw - 48px));
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
  color: var(--text-primary);
  text-transform: none;
  letter-spacing: normal;
  font-family: inherit;
  font-weight: 500;
  overflow-wrap: break-word;
  word-wrap: break-word;
  hyphens: auto;
  box-sizing: border-box;
  width: max-content;
}

.ref-help-text {
  display: block;
  font-size: 12px;
  line-height: 1.45;
}

.ref-help-link {
  display: inline;
  margin-top: 0;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 700;
  color: var(--accent-green);
  text-decoration: none;
}

.ref-help-link:hover {
  text-decoration: underline;
}
</style>
