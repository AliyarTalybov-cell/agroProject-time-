<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

withDefaults(
  defineProps<{
    text?: string
  }>(),
  {
    text: 'Функционал раздела ещё не завершён — логика будет дорабатываться.',
  },
)

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)

const pos = ref({ top: 0, left: 0, maxW: 320 })

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
  const gap = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.min(320, vw - margin * 2)

  let left = r.right + gap
  let top = r.top - 2
  pos.value = { top, left, maxW }

  void nextTick(() => {
    const tip = tooltipRef.value
    if (!tip) return
    const br = tip.getBoundingClientRect()
    let nextLeft = left
    let nextTop = top

    if (br.right > vw - margin) {
      nextLeft = Math.max(margin, r.left - gap - br.width)
    }
    if (nextLeft < margin) nextLeft = margin
    if (br.bottom > vh - margin) {
      nextTop = Math.max(margin, vh - margin - br.height)
    }
    if (nextTop < margin) nextTop = margin
    pos.value = { top: nextTop, left: nextLeft, maxW }
  })
}

function show() {
  cancelHide()
  open.value = true
  void nextTick(() => updatePosition())
}

function onScrollOrResize() {
  if (open.value) updatePosition()
}

function onTriggerClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (open.value) {
    open.value = false
  } else {
    show()
  }
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
    class="nav-status-hint"
    tabindex="0"
    role="button"
    aria-label="Статус раздела"
    @click="onTriggerClick"
    @mouseenter="show"
    @mouseleave="scheduleHide"
    @focusin="show"
    @focusout="scheduleHide"
  >
    <span class="nav-status-hint-icon" aria-hidden="true">?</span>
  </span>
  <Teleport to="body">
    <div
      v-show="open"
      ref="tooltipRef"
      class="nav-status-hint-tooltip"
      role="tooltip"
      :style="tooltipStyle"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
    >
      <span class="nav-status-hint-badge">В разработке</span>
      <span class="nav-status-hint-text">{{ text }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.nav-status-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 2px;
  vertical-align: middle;
  outline: none;
  flex-shrink: 0;
}

.nav-status-hint-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid currentColor;
  color: inherit;
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.65;
  cursor: help;
  transition: opacity 0.18s ease, color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.nav-status-hint:hover .nav-status-hint-icon,
.nav-status-hint:focus-visible .nav-status-hint-icon {
  opacity: 1;
  color: var(--accent-green);
  background: color-mix(in srgb, var(--accent-green) 16%, transparent);
  transform: scale(1.08);
}

.nav-status-hint:focus-visible {
  outline: 2px solid var(--accent-green);
  outline-offset: 2px;
  border-radius: 50%;
}

.nav-status-hint-tooltip {
  position: fixed;
  z-index: 20000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: min(220px, calc(100vw - 48px));
  width: max-content;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
  color: var(--text-primary);
  box-sizing: border-box;
}

.nav-status-hint-badge {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--warning-orange);
  background: color-mix(in srgb, var(--warning-orange) 16%, transparent);
}

.nav-status-hint-text {
  font-size: 12px;
  line-height: 1.45;
  font-weight: 500;
  overflow-wrap: break-word;
}

@media (prefers-reduced-motion: reduce) {
  .nav-status-hint-icon {
    transition: none;
  }
}
</style>
