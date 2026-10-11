<script setup lang="ts">
/**
 * «О сервисе» — инструкция по порталу: с чего начать, разделы меню (для чего и как
 * пользоваться), роли, общие приёмы и частые вопросы. Описывает только то, что
 * в портале действительно есть; при изменении разделов текст нужно обновлять.
 */
import type { Component } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import {
  ArrowRightIcon,
  BarChart3Icon,
  BellIcon,
  BookMarkedIcon,
  CalendarDaysIcon,
  LandPlotIcon,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  NewspaperIcon,
  SquareCheckBigIcon,
  TractorIcon,
  UserIcon,
  UsersIcon,
  WarehouseIcon,
  WheatIcon,
} from '@lucide/vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/shadcn/accordion'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

function scrollToId(id: string, ev?: MouseEvent) {
  ev?.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

interface GuideLink {
  label: string
  to: RouteLocationRaw
}

interface GuideSection {
  id: string
  icon: Component
  title: string
  /** Где в меню. */
  where: string
  /** Для чего раздел — одна-две фразы. */
  purpose: string
  /** Как пользоваться — шаги. */
  steps: string[]
  links: GuideLink[]
  /** Только для руководителя / оговорки. */
  note?: string
}

/** Порядок первоначальной настройки. */
const startSteps: { title: string; text: string; to: RouteLocationRaw }[] = [
  { title: 'Справочники', text: 'Культуры, типы земли, причины простоя, операции, типы мест хранения — всё, из чего потом выбирают в формах.', to: { path: '/lands', query: { tab: 'rights-refs' } } },
  { title: 'Земельные участки', text: 'Реестр участков с кадастром, площадью, правами и землепользователями.', to: '/lands' },
  { title: 'Поля', text: 'Поля внутри участков: площадь, культура, ответственный, точка или контур на карте.', to: '/fields' },
  { title: 'Места хранения', text: 'Склады, силосы, тока и бурты — куда принимается зерно.', to: '/warehouses/storage-locations' },
  { title: 'Техника', text: 'Машины и орудия — их выбирают при старте работ на экране оператора.', to: '/equipment' },
  { title: 'Сотрудники', text: 'Учётные записи, должности и роли — чтобы назначать задачи и писать в чат.', to: '/employees' },
]

const sections: GuideSection[] = [
  {
    id: 'guide-lands',
    icon: LandPlotIcon,
    title: 'Земли: участки, поля, мелиорация',
    where: 'Меню → Земли',
    purpose: 'Учёт земельного фонда: участки с документами, поля для работ и сведения по мелиорации.',
    steps: [
      '«Земельные участки» → «Новая земля»: номер, категория, тип земли, регион, площадь, кадастровый номер, вид разрешённого использования.',
      'Откройте участок: вкладки «Поля», «Права владения», «Землепользователи», «Севооборот», «Объекты недвижимости» — в каждой кнопка «Добавить».',
      '«Поля» → «Добавить поле»: название и площадь обязательны. На карте выберите участок для ориентира и поставьте точку или нарисуйте контур — адрес и геолокация заполнятся сами.',
      '«Мелиорация»: системы, защитные лесные насаждения и мероприятия — по вкладкам, кнопка «Добавить».',
      'Реестры выгружаются в PDF и Excel кнопками над таблицей.',
    ],
    links: [
      { label: 'Земельные участки', to: '/lands' },
      { label: 'Поля', to: '/fields' },
      { label: 'Мелиорация', to: { path: '/lands', query: { tab: 'melioration' } } },
    ],
  },
  {
    id: 'guide-stock',
    icon: WarehouseIcon,
    title: 'Склады',
    where: 'Меню → Склады',
    purpose: 'Сколько зерна лежит, где и какой культуры; все движения оформляются документами.',
    steps: [
      '«Места хранения» → «Добавить место хранения»: название, тип, статус, адрес, вместимость.',
      '«Карточки складов» показывают заполненность и культуры. В карточке склада — ячейки и партии, журнал операций склада, кнопка «Ячейка» для новой ячейки.',
      '«Приёмка» — зерно с поля (урожай) или закупка у поставщика: в новую партию или в существующую.',
      '«Перемещение» — из ячейки в ячейку, с массой, потерями в пути, машиной и водителем.',
      '«Операция» → «Продажа», «На посев», «Переработка / корм», «Списание», «Подработка» (сушка, очистка), «Инвентаризация».',
    ],
    links: [
      { label: 'Карточки складов', to: '/warehouses' },
      { label: 'Места хранения', to: '/warehouses/storage-locations' },
    ],
  },
  {
    id: 'guide-grain',
    icon: WheatIcon,
    title: 'Учёт зерна',
    where: 'Меню → Учёт зерна',
    purpose: 'Партии зерна, история всех операций и справочник покупателей и поставщиков.',
    steps: [
      '«Партии» — список с фильтрами по остатку, культуре, складу и назначению. В карточке партии: остаток, где лежит, качество; «Изменить» — сорт, урожай, назначение, показатели качества.',
      '«Журнал операций» — все документы по датам. Нажмите на строку, чтобы увидеть движения, транспорт и комментарий.',
      'Ошибочную операцию не удаляют: руководитель отменяет её (сторно) с указанием причины, остатки пересчитываются.',
      '«Контрагенты» — покупатели и поставщики с ИНН и контактами; их выбирают при продаже и закупке.',
    ],
    links: [
      { label: 'Партии', to: '/grain/batches' },
      { label: 'Журнал операций', to: '/grain/journal' },
      { label: 'Контрагенты', to: '/grain/counterparties' },
    ],
  },
  {
    id: 'guide-equipment',
    icon: TractorIcon,
    title: 'Техника',
    where: 'Меню → Техника',
    purpose: 'Каталог машин и навесных орудий с документами, фото и историей работы.',
    steps: [
      'Вкладка «Техника» → «Добавить технику»: марка и госномер обязательны, остальное — по документам (VIN, ПСМ, СВР, даты регистрации).',
      'Вкладка «Орудия» → «Добавить орудие»: плуги, сеялки и т. п.; орудие можно закрепить за машиной.',
      'В карточке техники — документы, фото и история: какие операции выполнялись, топливо до и после, состояние.',
    ],
    links: [{ label: 'Техника', to: '/equipment' }],
  },
  {
    id: 'guide-tasks',
    icon: SquareCheckBigIcon,
    title: 'Задачи',
    where: 'Меню → Задачи',
    purpose: 'Поручения по работам: кто, что, на каком поле и к какому сроку.',
    steps: [
      '«Создать задачу»: название (обязательно), исполнитель, поле, участники, приоритет, срок, тип работ, описание и файлы.',
      'Фильтры: «Все задачи» / «На мне», сотрудник, статус, срок с — по, поиск по номеру.',
      'Нажмите на задачу — откроется карточка: статус меняется прямо в ней («К выполнению», «В процессе», «На проверке», «Выполнено»), есть файлы, обсуждение и история изменений.',
      'Чтобы открыть задачу на отдельной странице, нажмите на неё с Ctrl (⌘ на Mac) или колёсиком мыши — или кнопку «Открыть в новой вкладке» в карточке.',
    ],
    links: [{ label: 'Задачи', to: '/task-management' }],
    note: 'Сотрудник ставит задачи себе; назначать исполнителя может руководитель.',
  },
  {
    id: 'guide-calendar',
    icon: CalendarDaysIcon,
    title: 'Календарь',
    where: 'Меню → Календарь',
    purpose: 'Встречи, напоминания и договорённости по времени — отдельно от производственных задач.',
    steps: [
      'Виды «День», «Неделя», «Месяц» и «Расписание»; мини-календарь слева переключает дату.',
      '«Создать событие»: название, описание, дата, время, приоритет, повтор, участники. Файлы прикрепляются после сохранения.',
      'Участники получают приглашение в «Уведомлениях».',
    ],
    links: [{ label: 'Календарь', to: '/tasks' }],
    note: 'Руководитель может открыть календарь любого сотрудника.',
  },
  {
    id: 'guide-operator',
    icon: MonitorSmartphoneIcon,
    title: 'Экран оператора',
    where: 'Меню → Операции → Экран оператора',
    purpose: 'Учёт работ прямо в поле: крупные кнопки, удобно с телефона и планшета.',
    steps: [
      'Выберите поле в списке «Поле».',
      '«Начать операцию» → выберите операцию → решите, нужна ли техника: укажите машину, план работ в га, топливо и состояние. Пойдёт таймер.',
      '«Пауза / простой» и «Продолжить» — во время работы. «Завершить операцию» — укажите, что сделано, сколько топлива осталось и сколько гектаров обработано.',
      'Если работа стоит — «Начать простой» с причиной, по окончании «Завершить простой».',
      '«Сообщить о проблеме»: опишите, при необходимости прикрепите файл и выберите, кому отправить, — сообщение придёт в чат как важное.',
      'Ниже — ваши задачи и события календаря на сегодня (кнопка «В работу» запускает операцию по задаче), техника в работе и журнал смены.',
    ],
    links: [{ label: 'Экран оператора', to: '/mechanic' }],
  },
  {
    id: 'guide-analytics',
    icon: BarChart3Icon,
    title: 'Аналитика',
    where: 'Меню → Аналитика',
    purpose: 'Сводка по уже введённым данным за выбранный период.',
    steps: [
      'Выберите период: «Сегодня», «Неделя», «Месяц» или свои даты. Руководитель может выбрать конкретного сотрудника.',
      'Вверху — люди в полях, техника в работе, часы простоя, выполненные задачи (нажмите, чтобы открыть их список).',
      'Ниже — кто сейчас работает или стоит, активные поля, состояние и топливо техники, задачи по статусам и по сотрудникам, завершённые операции по полям.',
    ],
    links: [{ label: 'Аналитика', to: '/reports' }],
  },
  {
    id: 'guide-team',
    icon: UsersIcon,
    title: 'Сотрудники и уведомления',
    where: 'Меню → Связь',
    purpose: 'Учётные записи коллег и всё, что требует вашего внимания.',
    steps: [
      '«Сотрудники» — карточки с контактами и ролью; поиск и фильтр по должности.',
      'Руководитель добавляет сотрудника: ФИО, почта, телефон, должность, роль и пароль; по нажатию на карточку — правка, отключение доступа или удаление.',
      '«Уведомления» — приглашения в события календаря и новости по задачам; фильтр «Не прочитано».',
    ],
    links: [
      { label: 'Сотрудники', to: '/employees' },
      { label: 'Уведомления', to: '/notifications' },
    ],
  },
  {
    id: 'guide-chat',
    icon: MessageCircleIcon,
    title: 'Чат',
    where: 'Меню → Связь → Чат',
    purpose: 'Быстрая связь: личные переписки и командные чаты.',
    steps: [
      '«Написать» — выберите сотрудника, откроется личный диалог.',
      'Сообщение — до 300 символов; Enter отправляет, Shift+Enter — новая строка. Файл — до 10 МБ, скрепкой у поля ввода.',
      'Своё сообщение можно удалить: правой кнопкой мыши, а на телефоне — свайпом влево или долгим нажатием.',
      'Число непрочитанных видно в меню рядом с «Чат»; вкладки «Непрочитанные» и «Команды» помогают найти нужное.',
    ],
    links: [{ label: 'Чат', to: '/chat' }],
    note: 'Команду (групповой чат) создаёт руководитель кнопкой «Новая команда».',
  },
  {
    id: 'guide-news',
    icon: NewspaperIcon,
    title: 'Новости и погода',
    where: 'Меню → Новости, Погода',
    purpose: 'Новости компании и условия для полевых работ.',
    steps: [
      '«Новости» — лента с обложками; нажмите, чтобы прочитать целиком и посмотреть галерею.',
      'Руководитель публикует новости: «Добавить новость» — заголовок, подводка, обложка, текст (можно вставить прямо из источника), галерея. «Сохранить» — с выбранной датой, «Опубликовать сейчас» — сразу.',
      '«Погода» — прогноз на 5 дней, подробные показатели, агро-условия на сутки, почасовой риск работ и состояние на ваших полях.',
    ],
    links: [
      { label: 'Новости', to: '/news' },
      { label: 'Погода', to: '/weather' },
    ],
  },
  {
    id: 'guide-settings',
    icon: BookMarkedIcon,
    title: 'Справочники и профиль',
    where: 'Меню → Настройки; меню пользователя внизу слева',
    purpose: 'Списки, из которых выбирают в формах, и ваши личные данные.',
    steps: [
      '«Настройки» → «Справочники»: права, земли, СХ культуры, мелиорация, техника, поля, севооборот, хранение.',
      'Причины простоя и операции для экрана оператора — в «Полях», вкладки «Причины простоя» и «Операции для работы».',
      'Не нашли нужное значение в списке — нажмите на «?» рядом с полем: там ссылка на нужный справочник.',
      'Профиль: имя, контакты, должность, фото, смена пароля.',
    ],
    links: [
      { label: 'Справочники', to: { path: '/lands', query: { tab: 'rights-refs' } } },
      { label: 'Профиль', to: '/profile' },
    ],
  },
]

const roles = [
  {
    title: 'Руководитель',
    icon: UserIcon,
    items: [
      'Назначает задачи любому сотруднику и видит календарь каждого',
      'Добавляет, правит и отключает сотрудников',
      'Публикует новости, создаёт командные чаты',
      'Отменяет ошибочные складские операции (сторно)',
      'Смотрит аналитику по всем или по конкретному сотруднику',
    ],
  },
  {
    title: 'Сотрудник',
    icon: UsersIcon,
    items: [
      'Работает на экране оператора: операции, простои, сообщения о проблемах',
      'Ставит задачи себе, ведёт свои задачи и календарь',
      'Пишет в чат и получает уведомления',
      'Видит аналитику по своей работе',
    ],
  },
]

const tips = [
  { title: 'Звёздочка *', text: 'Поле обязательно. Пока оно пустое, кнопка сохранения неактивна.' },
  { title: 'Знак «?» у поля', text: 'Подсказка и ссылка на справочник, где добавить недостающее значение.' },
  { title: 'Телефон и планшет', text: 'Все разделы работают на телефоне; меню открывается кнопкой слева вверху.' },
  { title: 'Тёмная тема', text: 'Переключатель — значок луны или солнца справа вверху.' },
  { title: 'Выгрузка', text: 'Реестры полей, земель, техники и задач выгружаются в PDF и Excel.' },
  { title: 'Новая вкладка', text: 'Задачу можно открыть отдельной страницей — Ctrl/⌘-клик по ней.' },
]

const faq = [
  { q: 'В выпадающем списке нет нужной культуры или типа', a: 'Добавьте значение в «Настройки» → «Справочники» в нужной группе — или нажмите «?» рядом с полем, там прямая ссылка. После этого значение появится в форме.' },
  { q: 'Ошиблись в складской операции', a: 'Документы не удаляются. Руководитель открывает «Журнал операций» и отменяет операцию (сторно) с причиной — остатки вернутся к прежним.' },
  { q: 'Почему на экране оператора нельзя сменить поле', a: 'Пока идёт операция или простой, поле закреплено. Завершите работу — и выберите другое поле.' },
  { q: 'Кнопка «Сохранить» неактивна', a: 'Заполнены не все поля со звёздочкой. Если ошибка пришла от сервера, окно само прокрутится к сообщению о ней.' },
  { q: 'Как открыть задачу на весь экран', a: 'Нажмите на задачу с Ctrl (⌘ на Mac) или колёсиком мыши — она откроется в новой вкладке. Из карточки — кнопка «Открыть в новой вкладке».' },
  { q: 'Какой размер файлов можно прикреплять', a: 'В чат — до 10 МБ, к схеме поля — JPG, PNG или PDF до 20 МБ.' },
]
</script>

<template>
  <div class="tw-scope flex min-w-0 flex-col gap-6">
    <!-- Вступление -->
    <section class="grid gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
      <div class="grid gap-2">
        <h2 class="text-xl font-semibold md:text-2xl">Как пользоваться порталом</h2>
        <p class="max-w-3xl text-sm text-muted-foreground md:text-base">
          Портал агронома собирает в одном месте земли и поля, склады и зерно, технику, задачи и связь с командой.
          Ниже — с чего начать и как работать в каждом разделе меню. В конце — роли, полезные приёмы и частые вопросы.
        </p>
      </div>
      <nav aria-label="Оглавление" class="flex flex-wrap gap-2">
        <a href="#guide-start" class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted" @click="scrollToId('guide-start', $event)">С чего начать</a>
        <a
          v-for="s in sections"
          :key="s.id"
          :href="`#${s.id}`"
          class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted"
          @click="scrollToId(s.id, $event)"
        >
          {{ s.title.split(':')[0] }}
        </a>
        <a href="#guide-roles" class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted" @click="scrollToId('guide-roles', $event)">Роли</a>
        <a href="#guide-faq" class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted" @click="scrollToId('guide-faq', $event)">Вопросы</a>
      </nav>
    </section>

    <!-- С чего начать -->
    <section id="guide-start" class="grid scroll-mt-4 gap-4">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold">С чего начать</h2>
        <p class="text-sm text-muted-foreground">Заполните разделы в этом порядке — тогда в формах везде будет выбор из готовых списков, а данные совпадут в задачах, на экране оператора и в аналитике.</p>
      </div>
      <ol class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <li v-for="(step, i) in startSteps" :key="step.title">
          <RouterLink
            :to="step.to"
            class="group flex h-full gap-3 rounded-xl border bg-card p-4 text-foreground no-underline shadow-xs transition-colors hover:bg-muted/40"
          >
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular-nums">{{ i + 1 }}</span>
            <span class="grid gap-1">
              <span class="flex items-center gap-1 text-sm font-medium">
                {{ step.title }}
                <ArrowRightIcon class="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </span>
              <span class="text-sm text-muted-foreground">{{ step.text }}</span>
            </span>
          </RouterLink>
        </li>
      </ol>
      <p class="text-sm text-muted-foreground">
        Дальше каждый день: руководитель ставит <strong class="font-medium text-foreground">задачи</strong>,
        сотрудники отмечают работу на <strong class="font-medium text-foreground">экране оператора</strong>,
        зерно проходит через <strong class="font-medium text-foreground">склады</strong>,
        а итоги видны в <strong class="font-medium text-foreground">аналитике</strong>.
      </p>
    </section>

    <!-- Разделы -->
    <section
      v-for="s in sections"
      :id="s.id"
      :key="s.id"
      class="grid scroll-mt-4 gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6"
    >
      <header class="flex items-start gap-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:text-ring">
          <component :is="s.icon" class="size-5" />
        </span>
        <div class="grid min-w-0 gap-1">
          <h2 class="text-lg font-semibold">{{ s.title }}</h2>
          <p class="text-xs text-muted-foreground">{{ s.where }}</p>
        </div>
      </header>
      <p class="text-sm md:text-base">{{ s.purpose }}</p>
      <ol class="grid gap-2">
        <li v-for="(step, i) in s.steps" :key="i" class="flex gap-3 text-sm leading-relaxed">
          <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">{{ i + 1 }}</span>
          <span>{{ step }}</span>
        </li>
      </ol>
      <p v-if="s.note" class="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{{ s.note }}</p>
      <div class="flex flex-wrap gap-2">
        <RouterLink
          v-for="link in s.links"
          :key="link.label"
          :to="link.to"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium text-foreground no-underline shadow-xs transition-colors hover:bg-accent"
        >
          {{ link.label }}
          <ArrowRightIcon class="size-3.5" />
        </RouterLink>
      </div>
    </section>

    <!-- Роли -->
    <section id="guide-roles" class="grid scroll-mt-4 gap-4">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold">Роли</h2>
        <p class="text-sm text-muted-foreground">Роль назначает руководитель при добавлении сотрудника. Сменить свою роль можно только через ИТ-отдел.</p>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="r in roles" :key="r.title" class="grid content-start gap-3 rounded-xl border bg-card p-4 shadow-xs md:p-6">
          <h3 class="flex items-center gap-2 text-base font-semibold">
            <component :is="r.icon" class="size-4 text-muted-foreground" />
            {{ r.title }}
          </h3>
          <ul class="grid gap-2">
            <li v-for="item in r.items" :key="item" class="flex gap-2 text-sm">
              <span class="mt-2 size-1.5 shrink-0 rounded-full bg-primary dark:bg-ring" aria-hidden="true" />
              {{ item }}
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- Приёмы -->
    <section class="grid gap-4">
      <h2 class="text-lg font-semibold">Полезно знать</h2>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="t in tips" :key="t.title" class="grid content-start gap-1 rounded-xl border bg-card p-4 shadow-xs">
          <span class="text-sm font-medium">{{ t.title }}</span>
          <span class="text-sm text-muted-foreground">{{ t.text }}</span>
        </div>
      </div>
    </section>

    <!-- Вопросы -->
    <section id="guide-faq" class="grid scroll-mt-4 gap-4">
      <h2 class="text-lg font-semibold">Частые вопросы</h2>
      <Accordion type="single" collapsible class="rounded-xl border bg-card px-4 shadow-xs md:px-6">
        <AccordionItem v-for="(item, i) in faq" :key="i" :value="`faq-${i}`">
          <AccordionTrigger class="text-left text-sm">{{ item.q }}</AccordionTrigger>
          <AccordionContent class="text-sm text-muted-foreground">{{ item.a }}</AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>

    <p class="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
      <BellIcon class="size-4" />
      Если что-то работает не так, как описано, — напишите руководителю или в ИТ-отдел через чат.
    </p>
  </div>
</template>
