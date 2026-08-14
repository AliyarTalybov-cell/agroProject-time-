<script setup lang="ts">
/**
 * Uiverse / vinodjangid07 — полоса загрузки.
 * Цвета — зелёная тема портала (--agro).
 */
withDefaults(
  defineProps<{
    size?: 'full' | 'md' | 'compact' | 'micro'
    /** Текст поверх полосы */
    label?: string
    /** Без текста (кнопки, мини-индикаторы) */
    hideLabel?: boolean
  }>(),
  {
    size: 'full',
    label: 'ЗАГРУЗКА',
    hideLabel: false,
  },
)
</script>

<template>
  <div
    class="ui-loading-bar"
    :class="[`ui-loading-bar--${size}`, { 'ui-loading-bar--no-label': hideLabel }]"
    role="status"
    aria-live="polite"
  >
    <div class="ui-loading-bar__loader">
      <div class="ui-loading-bar__wrapper">
        <div v-if="!hideLabel" class="ui-loading-bar__text">{{ label }}</div>
        <div class="ui-loading-bar__box" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-loading-bar {
  --lb-box: #3d5c40;
  --lb-strip: rgba(124, 184, 118, 0.55);
  --lb-text-shadow: #1e3320;
  display: flex;
  align-items: center;
  justify-content: center;
}

[data-theme='dark'] .ui-loading-bar {
  --lb-box: #4a6b4d;
  --lb-strip: rgba(160, 210, 150, 0.45);
  --lb-text-shadow: #0f1a10;
}

.ui-loading-bar__loader {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ui-loading-bar__wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.ui-loading-bar__text {
  position: relative;
  z-index: 3;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    sans-serif;
  letter-spacing: 1px;
  font-weight: 700;
  color: #fff;
  filter: drop-shadow(2px 2px 0 var(--lb-text-shadow));
  pointer-events: none;
  white-space: nowrap;
}

.ui-loading-bar__box {
  width: 100%;
  height: 100%;
  background-color: var(--lb-box);
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ui-lb-slide1-full 0.9s ease-in-out infinite alternate-reverse;
}

.ui-loading-bar__box::before {
  content: '';
  width: 20px;
  height: 170%;
  background-color: var(--lb-strip);
  position: absolute;
  z-index: 1;
  animation: ui-lb-slide2-full 0.9s ease-in-out infinite alternate-reverse;
}

.ui-loading-bar--no-label .ui-loading-bar__text {
  display: none;
}

/* ——— full: как в Uiverse ——— */
.ui-loading-bar--full .ui-loading-bar__wrapper {
  width: 180px;
  height: 50px;
}
.ui-loading-bar--full .ui-loading-bar__text {
  font-size: 20px;
}

/* ——— md ——— */
.ui-loading-bar--md .ui-loading-bar__wrapper {
  width: 150px;
  height: 42px;
}
.ui-loading-bar--md .ui-loading-bar__text {
  font-size: 16px;
  letter-spacing: 0.8px;
}
.ui-loading-bar--md .ui-loading-bar__box {
  animation-name: ui-lb-slide1-md;
}
.ui-loading-bar--md .ui-loading-bar__box::before {
  width: 17px;
  animation-name: ui-lb-slide2-md;
}

/* ——— compact — кнопки, узкие блоки ——— */
.ui-loading-bar--compact .ui-loading-bar__wrapper {
  width: 120px;
  height: 32px;
}
.ui-loading-bar--compact .ui-loading-bar__text {
  font-size: 11px;
  letter-spacing: 0.5px;
}
.ui-loading-bar--compact .ui-loading-bar__box {
  animation-name: ui-lb-slide1-compact;
}
.ui-loading-bar--compact .ui-loading-bar__box::before {
  width: 14px;
  animation-name: ui-lb-slide2-compact;
}

/* ——— micro — внутри маленьких кнопок ——— */
.ui-loading-bar--micro .ui-loading-bar__wrapper {
  width: 56px;
  height: 18px;
}
.ui-loading-bar--micro .ui-loading-bar__box {
  animation-name: ui-lb-slide1-micro;
}
.ui-loading-bar--micro .ui-loading-bar__box::before {
  width: 8px;
  height: 160%;
  animation-name: ui-lb-slide2-micro;
}

@keyframes ui-lb-slide1-full {
  0% {
    transform: translateX(-20px);
  }
  100% {
    transform: translateX(20px);
  }
}
@keyframes ui-lb-slide2-full {
  0% {
    transform: translateX(-50px);
  }
  100% {
    transform: translateX(50px);
  }
}

@keyframes ui-lb-slide1-md {
  0% {
    transform: translateX(-16px);
  }
  100% {
    transform: translateX(16px);
  }
}
@keyframes ui-lb-slide2-md {
  0% {
    transform: translateX(-40px);
  }
  100% {
    transform: translateX(40px);
  }
}

@keyframes ui-lb-slide1-compact {
  0% {
    transform: translateX(-12px);
  }
  100% {
    transform: translateX(12px);
  }
}
@keyframes ui-lb-slide2-compact {
  0% {
    transform: translateX(-28px);
  }
  100% {
    transform: translateX(28px);
  }
}

@keyframes ui-lb-slide1-micro {
  0% {
    transform: translateX(-6px);
  }
  100% {
    transform: translateX(6px);
  }
}
@keyframes ui-lb-slide2-micro {
  0% {
    transform: translateX(-14px);
  }
  100% {
    transform: translateX(14px);
  }
}
</style>
