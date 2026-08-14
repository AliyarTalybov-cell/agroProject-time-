<script setup lang="ts">
/**
 * «О сервисе» — презентационный лендинг (мотивы Shapes — Think Spatial), визуал на токенах портала: светлая/тёмная тема.
 * Секции: hero → оглавление → workflow (01–06) → погода → цитата → marquee → подвал.
 */
withDefaults(
  defineProps<{
    /** Вкладка «Обзор»: компенсируем padding main-content-inner для чёрного full-bleed */
    embedded?: boolean
  }>(),
  { embedded: false },
)

function scrollToId(id: string, ev?: MouseEvent) {
  ev?.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Якорное оглавление (карта страницы) */
const aboutToc = [
  { id: 'about-hero', label: 'Суть' },
  { id: 'about-step-01', label: '01 · Поля' },
  { id: 'about-step-02', label: '02 · Задачи' },
  { id: 'about-step-03', label: '03 · Оператор' },
  { id: 'about-step-04', label: '04 · Аналитика' },
  { id: 'about-step-05', label: '05 · Календарь' },
  { id: 'about-step-06', label: '06 · Чат' },
  { id: 'about-weather', label: 'Погода' },
] as const

const workflowSteps = [
  {
    n: '01',
    title: 'Заведи поля и технику',
    text:
      '«Поля и культуры»: карточка участка — площадь, кадастр, адрес, точка на карте, тип земли, культура, год, ответственный; при необходимости описание и медиа. Заполните справочники (земля, культуры, виды работ). «Техника» — каталог машин; дальше в формах везде выбор из списка, без расхождений в названиях.',
    image: '/about-workflow-step-01.png',
    /** Целиком скрин интерфейса — без обрезки (contain), чтобы читались подписи и вотермарк */
    imageFit: 'contain' as const,
    tags: ['Поля', 'Техника', 'Справочники'],
  },
  {
    n: '02',
    title: 'Поставь задачу за минуту',
    text:
      'Канбан: к выполнению, в процессе, на проверке, выполнено; фильтры по людям и статусам, выгрузка при необходимости. «Создать задачу» — исполнитель, поле, приоритет, срок, тип работ, описание. Карточка переезжает по колонкам; при готовых полях и справочниках форма остаётся короткой.',
    image: '/about-workflow-step-02.png',
    imageFit: 'contain' as const,
    tags: ['Задачи', 'Срок', 'Исполнитель'],
  },
  {
    n: '03',
    title: 'Работай в поле',
    text:
      'Крупные кнопки: в работу, простой, завершить — удобно из кабины и с телефона. Заранее заведите технику и справочники (операции, культуры, причины простоя): на поле только выбор из списков, данные совпадают с задачами и отчётами.',
    image: '/about-workflow-step-03.png',
    imageFit: 'contain' as const,
    tags: ['3 клика', 'Телефон', 'Факт в моменте'],
  },
  {
    n: '04',
    title: 'Смотри аналитику',
    text:
      'Сводки по уже введённым данным: задачи по статусам и по людям за период; блок «Операции на полях» — список за интервал, сортировка по сотруднику, числу операций, полям, времени, дате. Настройте даты в фильтрах портала — закрывайте период цифрами, без обзвона.',
    image: '/about-workflow-step-04.png',
    imageFit: 'contain' as const,
    tags: ['Период', 'Сводки', 'Прозрачность'],
  },
  {
    n: '05',
    title: 'Календарь: свои заметки и договорённости',
    text:
      'Не путать с канбаном: здесь личные напоминания и договорённости с коллегами. Можно открыть чужой день по «Сотруднику». Записи «Добавить задачу» попадают в планировщик. Производство по-прежнему в «Задачах», у оператора и в аналитике.',
    image: '/about-workflow-step-05.png',
    imageFit: 'contain' as const,
    tags: ['Календарь', 'Заметки', 'Коллеги'],
  },
  {
    n: '06',
    title: 'Чат и оперативная связь',
    text:
      'Лички и команды, поиск, вкладки; счётчик на «Чат» в меню — непрочитанные. Текст и файлы до 10 МБ, до 300 символов; Enter / Shift+Enter — под полем. Быстрые алерты по полю и технике; что обязано быть в учёте — дублируйте задачей или оператором.',
    image: '/about-workflow-step-06.png',
    imageFit: 'contain' as const,
    tags: ['Чат', 'Команды', 'Вложения'],
  },
] as const

const marqueeParts = [
  'Минимум текста',
  'Три клика',
  'Работает на телефоне',
  'Без обучения',
  'Прозрачность',
  'Учёт простоев',
] as const
</script>

<template>
  <div class="about-landing page-enter-item" :class="{ 'about-landing--embedded': embedded }">
    <main class="about-landing__main">
      <!-- Hero -->
      <section id="about-hero" class="about-hero">
        <p class="about-landing__meta about-hero__meta">[ Цифровое сельское хозяйство ]</p>
        <h1 class="about-hero__title about-serif"> Учёт, который работает в поле </h1>
        <p class="about-hero__context">
          Краткая памятка по разделам портала: с чего начать и как связаны поля, задачи, поле и отчёты. Те же разделы
          доступны в боковом меню слева — здесь собран смысл и порядок шагов. Если вы впервые на странице, пройдите по
          оглавлению ниже или откройте нужный пункт меню приложения.
        </p>
      </section>

      <!-- Карта страницы: якорная навигация -->
      <nav class="about-toc about-section" aria-label="Оглавление страницы «О сервисе»">
        <p class="about-landing__meta about-toc__label">[ Карта ]</p>
        <ul class="about-toc__list">
          <li v-for="item in aboutToc" :key="item.id">
            <a
              :href="'#' + item.id"
              class="about-toc__link"
              @click="scrollToId(item.id, $event)"
            >{{ item.label }}</a>
          </li>
        </ul>
      </nav>

      <!-- Workflow -->
      <section id="about-features" class="about-section about-workflow" aria-labelledby="about-workflow-h">
        <div class="about-workflow__head">
          <div>
            <p class="about-landing__meta">[ Production Flow ]</p>
            <h2 id="about-workflow-h" class="about-workflow__title about-serif">Как это работает</h2>
          </div>
          <p class="about-landing__meta about-workflow__seq">
            ШАГИ 01 — 06<br />
            ЛИНЕЙНЫЙ СЦЕНАРИЙ
          </p>
        </div>

        <ol class="about-workflow__list">
          <li
            :id="'about-step-' + step.n"
            v-for="step in workflowSteps"
            :key="step.n"
            class="about-workflow-item"
          >
            <div class="about-workflow-item__text">
              <span class="about-workflow-item__num about-serif" aria-hidden="true">{{ step.n }}</span>
              <h3 class="about-workflow-item__title about-serif">{{ step.title }}</h3>
              <p class="about-workflow-item__desc">{{ step.text }}</p>
              <div class="about-workflow-item__tags">
                <span v-for="t in step.tags" :key="t" class="about-workflow-item__tag">{{ t }}</span>
              </div>
            </div>
            <div
              class="about-workflow-item__visual"
              :class="{ 'about-workflow-item__visual--contain': 'imageFit' in step && step.imageFit === 'contain' }"
            >
              <img
                :src="step.image"
                :alt="step.title"
                class="about-workflow-item__img"
                :loading="'imageFit' in step && step.imageFit === 'contain' ? 'eager' : 'lazy'"
                decoding="async"
              >
            </div>
          </li>
        </ol>
      </section>

      <!-- Погода: сетка как у шагов workflow — текст слева, скрин справа -->
      <section id="about-weather" class="about-section about-weather" aria-labelledby="about-weather-title">
        <p class="about-landing__meta about-weather__kicker">[ Погода ]</p>
        <div class="about-weather__row">
          <div class="about-weather__copy">
            <h2 id="about-weather-title" class="about-weather__title about-serif">
              Погода для планирования смены
            </h2>
            <p class="about-weather__text">
              Страница «Погода и условия»: выбор населённого пункта и кнопка «Обновить», в баннере — температура, описание
              погоды, координаты и короткая рекомендация для работ (ветер, осадки и т. п.). Ниже — карточки показателей
              (ветер, влажность, давление, видимость, солнце и др.); часть расширенных меток может быть с пометкой PRO API.
              Внизу — прогноз на несколько дней. Имеет смысл смотреть рядом с полями, календарём и у оператора в поле.
            </p>
          </div>
          <div class="about-weather__media">
            <div
              class="about-workflow-item__visual about-workflow-item__visual--contain about-weather__shot"
            >
              <img
                src="/about-weather-screenshot.png"
                alt="Интерфейс раздела «Погода и условия»: выбор города, баннер с прогнозом, карточки показателей и прогноз по дням"
                class="about-workflow-item__img"
                loading="lazy"
                decoding="async"
              >
            </div>
          </div>
        </div>
      </section>

      <!-- Цитата -->
      <section id="about-quote" class="about-section about-quote">
        <blockquote class="about-quote__text about-serif">
          «Система не магически экономит миллионы. Она убирает ежедневную рутину. То, что занимало 2 часа, теперь
          занимает 20 минут»
        </blockquote>
      </section>

      <!-- Marquee: дублируем контент для бесшовной анимации translateX(-50%) -->
      <div class="about-marquee" aria-hidden="true">
        <div class="about-marquee__inner">
          <div class="about-marquee__track">
            <span v-for="(part, i) in marqueeParts" :key="`a-${i}`" class="about-marquee__group">
              <span class="about-marquee__item about-serif">{{ part }}</span>
              <span class="about-marquee__dot" />
            </span>
            <span v-for="(part, i) in marqueeParts" :key="`b-${i}`" class="about-marquee__group">
              <span class="about-marquee__item about-serif">{{ part }}</span>
              <span class="about-marquee__dot" />
            </span>
          </div>
        </div>
      </div>

      <footer id="about-footer" class="about-landing__footer about-landing__footer--combined">
        <div class="about-footer__inner">
          <div id="about-contact" class="about-footer__contact" aria-labelledby="about-contact-title">
            <img
              class="about-contact__avatar"
              src="/about-author.png"
              width="80"
              height="80"
              alt="Фото автора портала"
              loading="lazy"
              decoding="async"
            />
            <div class="about-contact__body">
              <h2 id="about-contact-title" class="about-contact__title">Связь с автором</h2>
              <p class="about-contact__line">
                <a class="about-contact__link" href="mailto:aliyartalybov@icloud.com">aliyartalybov@icloud.com</a>
              </p>
              <p class="about-contact__line">
                Telegram:
                <a
                  class="about-contact__link"
                  href="https://t.me/aliyarMSK"
                  target="_blank"
                  rel="noopener noreferrer"
                >@aliyarMSK</a>
              </p>
            </div>
          </div>
          <div class="about-footer__brand">
            <p class="about-landing__footer-brand">АГРОСИСТЕМА — 2026</p>
            <p class="about-landing__footer-meta about-landing__meta">Учёт в поле · три клика · минимум текста</p>
          </div>
        </div>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* --- Локальные алиасы поверх глобальных токенов портала (global.css :root / [data-theme='dark']) --- */
.about-landing {
  --ab-line: var(--border-color);
  --ab-muted: var(--text-secondary);
  --ab-meta: color-mix(in srgb, var(--text-secondary) 72%, var(--text-primary));
  --ab-marquee-bg: color-mix(in srgb, var(--bg-panel) 88%, var(--agri-primary));
  --ab-font-ui: 'Inter', system-ui, sans-serif;
  --ab-font-serif: 'Playfair Display', Georgia, serif;
  --ab-font-mono: 'Space Mono', ui-monospace, monospace;
  --ab-pad-x: clamp(20px, 4vw, 48px);
  --ab-scroll-margin: 12px;

  position: relative;
  box-sizing: border-box;
  background-color: var(--agri-bg);
  background-image: var(--bg-body-image);
  color: var(--text-primary);
  font-family: var(--ab-font-ui);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

.about-landing--embedded {
  width: calc(100% + 64px);
  max-width: none;
  margin-left: -32px;
  margin-right: -32px;
}

@media (max-width: 767px) {
  .about-landing--embedded {
    width: calc(100% + 48px);
    margin-left: -24px;
    margin-right: -24px;
  }
}

.about-serif {
  font-family: var(--ab-font-serif);
  font-weight: 400;
}

.about-landing__meta {
  font-family: var(--ab-font-mono);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ab-meta);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.about-landing__main {
  position: relative;
  z-index: 1;
  padding-top: 4px;
  padding-bottom: 28px;
}

/* --- Hero --- */
.about-hero {
  text-align: center;
  padding: clamp(12px, 2.5vw, 24px) var(--ab-pad-x) clamp(20px, 4vw, 40px);
  scroll-margin-top: var(--ab-scroll-margin);
}

.about-hero__meta {
  margin: 0 0 0.85rem;
}

.about-hero__title {
  font-size: clamp(2.5rem, 7.5vw, 5.5rem);
  line-height: 1.08;
  letter-spacing: -0.03em;
  margin: 0 auto;
  max-width: 14ch;
  color: var(--text-primary);
}

.about-hero__context {
  margin: clamp(0.75rem, 2vw, 1.25rem) auto 0;
  max-width: min(36rem, 100%);
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.65;
  color: var(--ab-muted);
  text-align: center;
}

/* --- Оглавление (якоря) --- */
.about-toc {
  padding-top: 0;
  padding-bottom: clamp(4px, 1.2vw, 12px);
}

.about-toc__label {
  margin: 0 0 8px;
}

.about-toc__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  justify-content: center;
}

.about-toc__link {
  display: inline-block;
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  color: var(--text-primary);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-card);
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.about-toc__link:hover {
  border-color: color-mix(in srgb, var(--accent-green) 40%, var(--border-color));
  color: var(--agri-primary);
  background: var(--bg-panel-hover);
}

/* --- Секции и цитаты --- */
.about-section {
  max-width: 1440px;
  margin: 0 auto;
  padding-left: var(--ab-pad-x);
  padding-right: var(--ab-pad-x);
  scroll-margin-top: var(--ab-scroll-margin);
}

/* --- Погода --- */
.about-weather {
  padding-top: clamp(32px, 6vw, 56px);
  padding-bottom: clamp(32px, 6vw, 64px);
  border-top: 1px solid var(--ab-line);
}

.about-weather__kicker {
  margin: 0 0 clamp(16px, 3vw, 24px);
}

.about-weather__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(28px, 5vw, 72px);
  align-items: start;
}

@media (max-width: 900px) {
  .about-weather__row {
    grid-template-columns: 1fr;
  }

  .about-weather__media {
    order: 2;
  }

  .about-weather__copy {
    order: 1;
  }
}

.about-weather__copy {
  min-width: 0;
}

.about-weather__title {
  margin: 0 0 14px;
  font-size: clamp(1.35rem, 2.8vw, 2rem);
  line-height: 1.2;
  color: var(--text-primary);
}

.about-weather__text {
  margin: 0;
  max-width: none;
  font-size: 1.02rem;
  line-height: 1.65;
  color: var(--ab-muted);
}

.about-weather__media {
  min-width: 0;
}

/* в колонке справа без лишнего внешнего margin — как .about-workflow-item__visual */
.about-weather__shot {
  margin: 0;
}

.about-quote {
  text-align: center;
  padding: clamp(28px, 6vw, 56px) 0;
}

.about-quote__text {
  margin: 0 auto;
  font-size: clamp(1.35rem, 3.2vw, 2.35rem);
  line-height: 1.18;
  letter-spacing: -0.02em;
  max-width: 840px;
  color: var(--ab-muted);
}

/* --- Workflow --- */
.about-workflow {
  padding-top: clamp(24px, 6vw, 48px);
  padding-bottom: clamp(48px, 10vw, 100px);
}

.about-workflow__head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  margin-bottom: clamp(48px, 10vw, 100px);
}

.about-workflow__title {
  margin: 0.5rem 0 0;
  font-size: clamp(1.85rem, 4vw, 3rem);
  color: var(--text-primary);
}

.about-workflow__seq {
  margin: 0;
  text-align: right;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .about-workflow__seq {
    text-align: left;
    width: 100%;
  }
}

.about-workflow__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(64px, 14vw, 120px);
}

.about-workflow-item {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: clamp(32px, 6vw, 80px);
  align-items: center;
  scroll-margin-top: calc(var(--ab-scroll-margin) + 8px);
}

.about-workflow-item:nth-child(even) {
  direction: rtl;
}

.about-workflow-item:nth-child(even) > * {
  direction: ltr;
}

@media (max-width: 900px) {
  .about-workflow-item {
    grid-template-columns: 1fr;
  }

  .about-workflow-item:nth-child(even) {
    direction: ltr;
  }
}

.about-workflow-item__num {
  display: block;
  font-size: clamp(4rem, 12vw, 7.5rem);
  line-height: 0.85;
  color: var(--ab-meta);
  opacity: 0.35;
  margin-bottom: 1rem;
}

.about-workflow-item__title {
  font-size: clamp(1.4rem, 3vw, 2.25rem);
  margin: 0 0 12px;
  line-height: 1.2;
  color: var(--text-primary);
}

.about-workflow-item__desc {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 300;
  line-height: 1.6;
  color: var(--ab-muted);
  max-width: 400px;
}

.about-workflow-item__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}

.about-workflow-item__tag {
  border: 1px solid var(--border-color);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.72rem;
  color: var(--ab-muted);
}

.about-workflow-item__visual {
  width: 100%;
  aspect-ratio: 4/5;
  border-radius: clamp(16px, 3vw, 24px);
  overflow: hidden;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-card);
}

/* Полный скрин UI: видно кадр целиком, подписи не обрезаются */
.about-workflow-item__visual--contain {
  aspect-ratio: auto;
  overflow: hidden;
  padding: clamp(10px, 2vw, 16px);
  background: color-mix(in srgb, var(--bg-panel) 88%, var(--border-color));
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.about-workflow-item__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: clamp(12px, 2.5vw, 18px);
  opacity: 0.82;
  transition:
    opacity 0.45s ease,
    transform 8s ease;
}

.about-workflow-item__visual--contain .about-workflow-item__img {
  width: 100%;
  height: auto;
  max-width: 100%;
  object-fit: contain;
  object-position: center top;
  opacity: 1;
}

.about-workflow-item__visual:hover .about-workflow-item__img {
  opacity: 1;
  transform: scale(1.04);
}

.about-workflow-item__visual--contain:hover .about-workflow-item__img {
  transform: none;
}

/* --- Marquee --- */
.about-marquee {
  width: 100%;
  overflow: hidden;
  padding: clamp(28px, 6vw, 56px) 0;
  background: var(--ab-marquee-bg);
  border-top: 1px solid var(--border-color);
  border-bottom: 1px solid var(--border-color);
  position: relative;
}

.about-marquee::before,
.about-marquee::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: min(18vw, 140px);
  z-index: 2;
  pointer-events: none;
}

.about-marquee::before {
  left: 0;
  background: linear-gradient(to right, var(--ab-marquee-bg), transparent);
}

.about-marquee::after {
  right: 0;
  background: linear-gradient(to left, var(--ab-marquee-bg), transparent);
}

.about-marquee__inner {
  overflow: hidden;
}

.about-marquee__track {
  display: flex;
  width: max-content;
  animation: about-marquee-scroll 42s linear infinite;
}

.about-marquee__group {
  display: inline-flex;
  align-items: center;
  gap: clamp(24px, 4vw, 56px);
  padding: 0 clamp(16px, 3vw, 36px);
}

.about-marquee__item {
  font-size: clamp(1.35rem, 3.5vw, 2.35rem);
  white-space: nowrap;
  color: var(--text-primary);
}

.about-marquee__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ab-meta);
  flex-shrink: 0;
}

@keyframes about-marquee-scroll {
  0% {
    transform: translateX(0);
  }

  100% {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .about-marquee__track {
    animation: none;
  }

  .about-workflow-item__img {
    transition: none;
  }
}

/* --- Подвал: контакт + бренд в одной полосе (фон как у страницы, без отдельной зелёной плашки) --- */
.about-landing__footer--combined {
  max-width: none;
  margin: 0;
  padding: clamp(14px, 2.5vw, 22px) var(--ab-pad-x);
  scroll-margin-top: var(--ab-scroll-margin);
  border-top: 1px solid var(--ab-line);
  background: transparent;
  color: var(--text-primary);
}

.about-footer__inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: clamp(14px, 3vw, 24px);
}

.about-footer__contact {
  display: flex;
  align-items: center;
  gap: clamp(12px, 2.5vw, 18px);
  min-width: 0;
  text-align: left;
}

.about-footer__brand {
  text-align: right;
  min-width: min(100%, 220px);
}

.about-contact__avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  object-position: center 18%;
  flex-shrink: 0;
  border: none;
  box-shadow: none;
  background: transparent;
  display: block;
}

.about-contact__body {
  min-width: 0;
}

.about-contact__title {
  margin: 0 0 6px;
  font-size: 0.65rem;
  font-family: var(--ab-font-mono);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ab-meta);
}

.about-contact__line {
  margin: 0 0 4px;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--ab-muted);
}

.about-contact__line:last-child {
  margin-bottom: 0;
}

.about-landing__footer--combined .about-contact__link {
  color: var(--text-primary);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.15s ease;
}

.about-landing__footer--combined .about-contact__link:hover {
  color: var(--agri-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.about-landing__footer-brand {
  margin: 0 0 4px;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-primary);
}

.about-landing__footer-meta {
  margin: 0;
}

@media (max-width: 700px) {
  .about-footer__inner {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .about-footer__contact {
    flex-direction: column;
    text-align: center;
  }

  .about-footer__brand {
    text-align: center;
    padding-top: 8px;
    border-top: 1px solid var(--ab-line);
    width: 100%;
    min-width: 0;
    padding-left: 8px;
    padding-right: 8px;
  }
}
</style>
