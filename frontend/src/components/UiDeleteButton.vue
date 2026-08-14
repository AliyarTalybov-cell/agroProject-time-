<script setup lang="ts">
import UiLoadingBar from '@/components/UiLoadingBar.vue'
import UiTrashIcon from '@/components/UiTrashIcon.vue'

withDefaults(
  defineProps<{
    disabled?: boolean
    loading?: boolean
    ariaLabel?: string
    size?: 'xs' | 'sm' | 'md' | 'lg'
    /** @deprecated не используется */
    wide?: boolean
  }>(),
  {
    ariaLabel: 'Удалить',
    size: 'sm',
    wide: false,
  },
)

const emit = defineEmits<{ click: [e: MouseEvent] }>()

function onClick(e: MouseEvent) {
  emit('click', e)
}
</script>

<template>
  <!-- Невидимый padding снизу = зона hover: плашка под иконкой иначе вне hit-box кнопки и сразу пропадает -->
  <span
    class="ui-del-root"
    :class="{ 'ui-del-root--disabled': disabled || loading }"
  >
    <button
      type="button"
      class="ui-del-btn"
      :class="[`ui-del-btn--${size}`, { 'ui-del-btn--loading': loading }]"
      :disabled="disabled || loading"
      :aria-label="loading ? 'Удаление…' : ariaLabel"
      @click="onClick"
    >
      <span v-if="!loading" class="ui-del-btn__pill" aria-hidden="true">Удалить</span>
      <span class="ui-del-btn__icon-wrap" aria-hidden="true">
        <UiTrashIcon class="ui-del-btn__trash" />
      </span>
      <UiLoadingBar
        v-if="loading"
        size="micro"
        hide-label
        class="ui-del-btn__loading-bar"
      />
    </button>
  </span>
</template>

<style scoped>
.ui-del-root {
  display: inline-flex;
  vertical-align: middle;
  position: relative;
  overflow: visible;
  /* Мост под иконкой: наведение на плашку «Удалить» не сбрасывает hover */
  padding-bottom: 42px;
  margin-bottom: -38px;
}

.ui-del-root:hover:not(.ui-del-root--disabled) {
  z-index: 25;
}

.ui-del-root--disabled {
  padding-bottom: 0;
  margin-bottom: 0;
}

/* Плашка только при hover / focus-visible; текст всегда «Удалить» */
.ui-del-btn {
  box-sizing: border-box;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  flex-shrink: 0;
  /* 6+18+6 ≈ 30px как у соседних кнопок с иконкой 18px */
  min-width: max(30px, fit-content);
  border: none;
  border-radius: 8px;
  background-color: transparent;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  overflow: visible;
  vertical-align: middle;
  color: var(--text-secondary, #64748b);
  padding: var(--ui-del-pad-y) var(--ui-del-pad-x);
}

/* Плашка снизу: при overflow-x:auto у таблиц верх обрезается — снизу видно стабильнее */
.ui-del-btn__pill {
  position: absolute;
  top: 100%;
  left: 50%;
  margin-top: 6px;
  width: max-content;
  max-width: min(var(--ui-del-pill-max), calc(100vw - 24px));
  padding: var(--ui-del-pill-py) var(--ui-del-pill-px);
  border-radius: 5px;
  background-color: rgb(168, 7, 7);
  color: #fff;
  font-size: var(--ui-del-pill-fs);
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 20;
  pointer-events: none;
  transform: translateX(-50%) translateY(-6px);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s linear,
    visibility 0.2s linear,
    transform 0.2s linear;
  transition-delay: 0s;
}

.ui-del-root:hover:not(.ui-del-root--disabled) .ui-del-btn__pill,
.ui-del-btn:hover:not(:disabled):not(.ui-del-btn--loading) .ui-del-btn__pill,
.ui-del-btn:focus-visible:not(:disabled):not(.ui-del-btn--loading) .ui-del-btn__pill {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
  transition-delay: 0.15s;
}

.ui-del-btn__icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Высота как у svg 18×18 в .fields-action-btn / .equipment-action-btn */
.ui-del-btn__trash {
  display: block;
  flex-shrink: 0;
  width: calc(var(--ui-trash-h) * 15 / 17.5);
  height: var(--ui-trash-h);
  color: currentColor;
  transform: scale(1);
  transition:
    transform 0.2s linear,
    color 0.2s linear;
}

.ui-del-btn__trash :deep(path) {
  fill: currentColor;
}

.ui-del-root:hover:not(.ui-del-root--disabled) .ui-del-btn__trash,
.ui-del-btn:hover:not(:disabled):not(.ui-del-btn--loading) .ui-del-btn__trash,
.ui-del-btn:focus-visible:not(:disabled):not(.ui-del-btn--loading) .ui-del-btn__trash {
  transform: scale(1.12);
  color: rgb(168, 7, 7);
}

.ui-del-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, rgb(168, 7, 7) 65%, white);
  outline-offset: 2px;
}

.ui-del-btn:disabled,
.ui-del-btn--loading {
  opacity: 0.45;
  cursor: not-allowed;
}

.ui-del-btn--loading .ui-del-btn__icon-wrap {
  opacity: 0;
}

.ui-del-btn__loading-bar {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* xs/sm: одна визуальная сетка с иконками 18×18 в таблицах техника/поля/справочники */
.ui-del-btn--xs {
  --ui-trash-h: 18px;
  --ui-del-pad-y: 6px;
  --ui-del-pad-x: 6px;
  --ui-del-pill-fs: 10px;
  --ui-del-pill-py: 3px;
  --ui-del-pill-px: 6px;
  --ui-del-pill-max: 220px;
}

.ui-del-btn--sm {
  --ui-trash-h: 18px;
  --ui-del-pad-y: 6px;
  --ui-del-pad-x: 6px;
  --ui-del-pill-fs: 10px;
  --ui-del-pill-py: 3px;
  --ui-del-pill-px: 6px;
  --ui-del-pill-max: 220px;
}

.ui-del-btn--md {
  --ui-trash-h: 20px;
  --ui-del-pad-y: 6px;
  --ui-del-pad-x: 8px;
  --ui-del-pill-fs: 11px;
  --ui-del-pill-py: 3px;
  --ui-del-pill-px: 7px;
  --ui-del-pill-max: 260px;
}

.ui-del-btn--lg {
  --ui-trash-h: 22px;
  --ui-del-pad-y: 8px;
  --ui-del-pad-x: 10px;
  --ui-del-pill-fs: 12px;
  --ui-del-pill-py: 4px;
  --ui-del-pill-px: 8px;
  --ui-del-pill-max: 280px;
}

.ui-del-btn--xs .ui-del-btn__loading-bar :deep(.ui-loading-bar) {
  transform: scale(0.34);
}
.ui-del-btn--sm .ui-del-btn__loading-bar :deep(.ui-loading-bar) {
  transform: scale(0.42);
}
.ui-del-btn--md .ui-del-btn__loading-bar :deep(.ui-loading-bar) {
  transform: scale(0.52);
}
.ui-del-btn--lg .ui-del-btn__loading-bar :deep(.ui-loading-bar) {
  transform: scale(0.64);
}

[data-theme='dark'] .ui-del-btn {
  color: var(--text-secondary, rgba(255, 255, 255, 0.55));
}
</style>
