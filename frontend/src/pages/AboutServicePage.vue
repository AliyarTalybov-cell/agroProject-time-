<script setup lang="ts">
/**
 * «О сервисе» — инструкция по порталу. Каждый раздел: зачем он, как устроен и
 * свёрнутые инструкции «Как сделать…» по шагам с итогом. Описывает только то,
 * что в портале действительно есть: при изменении форм текст и снимки
 * (public/about) нужно обновлять. На снимках личные данные заменены условными.
 */
import type { Component } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import {
  ArrowRightIcon,
  BarChart3Icon,
  BellIcon,
  BookMarkedIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  LandPlotIcon,
  LayersIcon,
  MessageCircleIcon,
  MonitorSmartphoneIcon,
  NewspaperIcon,
  PackageIcon,
  SquareCheckBigIcon,
  TractorIcon,
  UserIcon,
  UsersIcon,
  WarehouseIcon,
} from '@lucide/vue'
import { ref } from 'vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/shadcn/accordion'
import ImagePreviewDialog from '@/components/ui/dialogs/ImagePreviewDialog.vue'

const preview = ref<{ src: string; alt: string } | null>(null)

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

function scrollToId(id: string, ev?: MouseEvent) {
  ev?.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

interface GuideLink {
  label: string
  to: RouteLocationRaw
}

/** Инструкция «Как сделать…». */
interface HowTo {
  title: string
  /** Когда это нужно — одна фраза. */
  when?: string
  steps: string[]
  /** Что получится после. */
  result?: string
  /** Только для руководителя и т. п. */
  note?: string
}

interface GuideSection {
  id: string
  icon: Component
  title: string
  /** Короткое имя для оглавления. */
  short: string
  /** Где в меню. */
  where: string
  /** Для чего раздел — одна-две фразы. */
  purpose: string
  howtos: HowTo[]
  links: GuideLink[]
  /** Снимки экрана (public/about). Персональные данные на них заменены условными. */
  shots?: { src: string; alt: string; phone?: boolean }[]
}

/** Порядок первоначальной настройки. */
const startSteps: { title: string; text: string; to: RouteLocationRaw }[] = [
  { title: 'Справочники', text: 'Культуры, типы земли, причины простоя, операции, типы складов — из них потом выбирают в формах.', to: { path: '/lands', query: { tab: 'rights-refs' } } },
  { title: 'Земельные участки', text: 'Участки с кадастром, площадью и правами.', to: '/lands' },
  { title: 'Поля', text: 'Поля внутри участков: площадь, культура, ответственный, место на карте.', to: '/fields' },
  { title: 'Склады', text: 'Склады, силосы, тока и бурты — куда принимается зерно.', to: '/warehouses/storage-locations' },
  { title: 'Техника', text: 'Машины и орудия — их выбирают на экране оператора.', to: '/equipment' },
  { title: 'Сотрудники', text: 'Учётные записи и роли — чтобы ставить задачи и писать в чат.', to: '/employees' },
]

/* ——— Склады и зерно: как устроено ——— */

const stockScheme = [
  { icon: WarehouseIcon, title: 'Склад', text: 'Место хранения: склад, силос, ток или бурт. Вместимость в тоннах.' },
  { icon: LayersIcon, title: 'Ячейка', text: 'Часть склада: отсек, силос, угол. В ячейке — только одна культура. «Основная» есть у каждого склада сразу.' },
  { icon: PackageIcon, title: 'Партия', text: 'Зерно одного происхождения: с какого поля или от какого поставщика, урожай года, сорт, качество.' },
  { icon: FileTextIcon, title: 'Документ', text: 'Любое движение зерна: приёмка, перемещение, продажа, списание… Остаток считается по документам.' },
]

const stockRules = [
  'Остаток нельзя исправить вручную — только документом. Поэтому цифры всегда сходятся с историей.',
  'В одной ячейке — одна культура. Пшеницу и ячмень на одном складе кладите в разные ячейки.',
  'Если у ячейки указана вместимость, принять больше не получится.',
  'Ошибочный документ не удаляют, а отменяют: руководитель делает это в «Журнале операций», остатки возвращаются.',
]

const stockSetup: HowTo = {
  title: 'Подготовить склады к работе (один раз)',
  steps: [
    'Меню → Настройки → «Справочники хранения»: проверьте типы мест хранения, статусы, причины списания, направления расхода и назначения партий. Это значения для списков в формах.',
    'Меню → Склады → «Места хранения» → «Добавить место хранения»: название, тип, статус, адрес и вместимость в тоннах.',
    'Если склад делится на отсеки или силосы — откройте склад из «Карточек складов» и нажмите «Ячейка»: название, тип и вместимость. Не делится — работайте с ячейкой «Основная».',
    'Меню → Учёт зерна → «Контрагенты» → «Добавить контрагента»: покупатели и поставщики с ИНН. Без них не провести закупку и продажу.',
  ],
  result: 'Склады видны в «Карточках складов», и в них можно принимать зерно.',
}

const sections: GuideSection[] = [
  {
    id: 'guide-stock',
    icon: WarehouseIcon,
    title: 'Склады и учёт зерна',
    short: 'Склады и зерно',
    where: 'Меню → Склады; Меню → Учёт зерна',
    purpose: 'Сколько зерна лежит, где, какой культуры и откуда оно пришло. Любое движение зерна — это документ, по документам считается остаток.',
    howtos: [
      {
        title: 'Принять урожай с поля',
        when: 'Машина с зерном пришла с поля на склад.',
        steps: [
          'Склады → «Карточки складов» → у нужного склада «Приёмка» (или откройте склад и нажмите «Приёмка»).',
          '«Откуда зерно» — «С поля (урожай)», выберите поле и культуру.',
          '«Партия» — «Новая партия». Если это зерно того же поля и культуры, что уже лежит, — «Досыпать в существующую» и выберите партию.',
          '«Куда» — ячейка склада. Ячейка с другой культурой не подойдёт — форма предупредит.',
          'Масса: введите «Брутто» и «Тару» с весовой — масса посчитается сама, или впишите «Массу зерна» сразу.',
          'Качество из лаборатории: влажность и примеси обязательны, натура, клейковина и протеин — по желанию.',
          'Проверьте «Зачётный вес» внизу формы, при необходимости заполните госномер, водителя и ТТН → «Провести приёмку».',
        ],
        result: 'Остаток склада вырос на зачётный вес, партия появилась в «Партиях», документ — в «Журнале операций».',
      },
      {
        title: 'Закупить зерно у поставщика',
        when: 'Зерно куплено и привезено на склад.',
        steps: [
          'Склад → «Приёмка» → «Откуда зерно» — «Закупка у поставщика».',
          'Выберите поставщика. Его нет в списке — сначала добавьте его в «Контрагентах».',
          'Дальше как при приёмке с поля: партия, ячейка, масса, качество.',
          'Укажите «Цену за тонну» — сумма посчитается сама → «Провести приёмку».',
        ],
        result: 'Партия с пометкой «Закупка» и суммой в документе.',
      },
      {
        title: 'Переместить зерно в другую ячейку или на другой склад',
        steps: [
          'Склад, откуда везёте → «Перемещение».',
          '«Что и откуда» — партия в ячейке; «Куда» — ячейка этого или другого склада.',
          'Масса и, если были, «Потери в пути»; машина, водитель и ТТН — по желанию → «Переместить».',
        ],
        result: 'Партия убыла в одной ячейке и прибыла в другой; потери списаны.',
      },
      {
        title: 'Высушить или очистить зерно (подработка)',
        when: 'После сушки или очистки масса уменьшилась, а качество изменилось.',
        steps: [
          'Склад → «Операция» → «Подработка».',
          'Выберите партию в ячейке, впишите «Массу до» и «Массу после».',
          'В «Качестве после подработки» — новые влажность и примеси → «Провести подработку».',
        ],
        result: 'Остаток уменьшился на разницу, у партии новые показатели качества.',
      },
      {
        title: 'Продать зерно',
        steps: [
          'Склад → «Операция» → «Продажа».',
          'Выберите покупателя (из «Контрагентов»).',
          '«Из каких партий» — партия и масса. Нужно отгрузить из нескольких партий — «Ещё партия».',
          'Цена за тонну, «Вес у покупателя» (если отличается), машина, ТТН, СДИЗ → «Провести продажу».',
        ],
        result: 'Остаток уменьшился, в журнале — продажа с суммой.',
      },
      {
        title: 'Выдать семена на посев',
        steps: ['Склад → «Операция» → «На посев».', 'Выберите поле, куда идут семена, партию и массу → «Выдать на посев».'],
        result: 'Расход привязан к полю — видно, чем и сколько засеяно.',
      },
      {
        title: 'Отдать на переработку или корм',
        steps: [
          'Склад → «Операция» → «Переработка / корм».',
          '«Куда» — направление расхода (список задаётся в «Справочниках хранения»), партия и масса → «Провести расход».',
        ],
      },
      {
        title: 'Списать зерно (порча, недостача)',
        steps: ['Склад → «Операция» → «Списание».', 'Выберите причину, партию и массу, при необходимости номер акта → «Списать».'],
      },
      {
        title: 'Провести инвентаризацию',
        when: 'Пересчитали зерно в ячейке, и факт не совпал с учётом.',
        steps: [
          'Склад → «Операция» → «Инвентаризация» → выберите ячейку.',
          'По каждой партии видно, сколько «По учёту»; впишите «Фактически, т» — разница посчитается сама.',
          'Номер акта и комментарий → «Провести инвентаризацию».',
        ],
        result: 'Остаток стал равен факту, излишек или недостача записаны документом.',
      },
      {
        title: 'Исправить ошибку в операции',
        when: 'Ошиблись в весе, ячейке, партии или провели лишний документ.',
        steps: [
          'Учёт зерна → «Журнал операций», найдите документ (фильтры по виду операции и датам).',
          'В строке документа — «Отменить», укажите причину, например «ошибка в весе».',
          'Проведите операцию заново с верными данными.',
        ],
        result: 'Отменённый документ остаётся в журнале с пометкой «отменён», остатки вернулись к прежним.',
        note: 'Отменять документы может только руководитель.',
      },
      {
        title: 'Узнать, сколько и где лежит',
        steps: [
          '«Карточки складов» — по каждому складу: сколько лежит, заполненность и культуры. Фильтры «Культура» и «Заполнение».',
          'Внутри склада — ячейки с партиями и журнал этого склада.',
          'Учёт зерна → «Партии» — все партии с остатком и где они лежат; поиск по номеру, сорту, полю, поставщику.',
          'В карточке партии — качество, где лежит и «История партии»: все документы с ней. «Изменить» — сорт, урожай, класс, назначение, показатели качества.',
        ],
      },
    ],
    shots: [
      { src: '/about/warehouses.webp', alt: 'Карточки складов' },
      { src: '/about/journal.webp', alt: 'Журнал операций с раскрытым документом' },
    ],
    links: [
      { label: 'Карточки складов', to: '/warehouses' },
      { label: 'Места хранения', to: '/warehouses/storage-locations' },
      { label: 'Партии', to: '/grain/batches' },
      { label: 'Журнал операций', to: '/grain/journal' },
      { label: 'Контрагенты', to: '/grain/counterparties' },
    ],
  },
  {
    id: 'guide-lands',
    icon: LandPlotIcon,
    title: 'Земли, поля и мелиорация',
    short: 'Земли и поля',
    where: 'Меню → Земли',
    purpose: 'Земельный фонд: участки с документами, поля внутри них и мелиорация. Поля потом выбирают в задачах, на экране оператора и при приёмке урожая.',
    howtos: [
      {
        title: 'Добавить земельный участок',
        steps: [
          'Земли → «Земельные участки» → «Новая земля».',
          'Номер, категория, тип земли, регион, площадь, кадастровый номер, вид разрешённого использования → сохранить.',
          'Откройте участок: вкладки «Права владения», «Землепользователи», «Севооборот», «Объекты недвижимости» — в каждой «Добавить».',
        ],
      },
      {
        title: 'Добавить поле',
        steps: [
          'Земли → «Поля» → «Добавить поле».',
          'Название и площадь обязательны; культура, ответственный, участок — по желанию.',
          'На карте выберите участок для ориентира и поставьте точку или нарисуйте контур — адрес и координаты заполнятся сами.',
        ],
        result: 'Поле можно выбрать в задачах, на экране оператора и при приёмке урожая; погода по нему видна в «Погоде».',
      },
      {
        title: 'Внести мелиорацию',
        steps: ['Земли → «Мелиорация»: вкладки систем, лесных насаждений и мероприятий.', 'На нужной вкладке — «Добавить».'],
      },
      { title: 'Выгрузить реестр', steps: ['Над таблицей участков или полей — кнопки PDF и Excel.'] },
    ],
    shots: [{ src: '/about/fields.webp', alt: 'Реестр полей' }],
    links: [
      { label: 'Земельные участки', to: '/lands' },
      { label: 'Поля', to: '/fields' },
      { label: 'Мелиорация', to: { path: '/lands', query: { tab: 'melioration' } } },
    ],
  },
  {
    id: 'guide-operator',
    icon: MonitorSmartphoneIcon,
    title: 'Экран оператора',
    short: 'Экран оператора',
    where: 'Меню → Операции → Экран оператора',
    purpose: 'Отметка работ прямо в поле: крупные кнопки, удобно с телефона. Из этих отметок строятся аналитика, история техники и «Сейчас в поле».',
    howtos: [
      {
        title: 'Начать и закончить работу',
        steps: [
          'Выберите поле в списке «Поле».',
          '«Начать операцию» → выберите операцию (вспашка, посев…) → если работаете на технике, укажите машину, план в га, топливо и состояние. Пойдёт таймер.',
          'Перерыв или остановка во время работы — «Пауза / простой», затем «Продолжить».',
          'Закончили — «Завершить операцию»: что сделано, сколько гектаров обработано, сколько топлива осталось.',
        ],
        result: 'Работа записана в журнал смены, видна руководителю в «Аналитике» и в истории техники.',
      },
      {
        title: 'Отметить простой',
        when: 'Работа стоит: поломка, погода, ждём технику.',
        steps: ['«Начать простой» → выберите причину.', 'Когда работа возобновилась — «Завершить простой».'],
        result: 'Часы простоя и причина видны в «Аналитике».',
      },
      {
        title: 'Сообщить о проблеме',
        steps: ['«Сообщить о проблеме» → опишите, при необходимости прикрепите фото.', 'Выберите, кому отправить.'],
        result: 'Сообщение придёт в чат с отметкой «Важно».',
      },
      {
        title: 'Начать работу по задаче',
        steps: ['Ниже на экране — ваши задачи на сегодня.', 'У задачи — «В работу»: операция начнётся сразу по её полю.'],
      },
    ],
    shots: [
      { src: '/about/operator.webp', alt: 'Экран оператора' },
      { src: '/about/operator-phone.webp', alt: 'Экран оператора на телефоне', phone: true },
    ],
    links: [{ label: 'Экран оператора', to: '/mechanic' }],
  },
  {
    id: 'guide-tasks',
    icon: SquareCheckBigIcon,
    title: 'Задачи',
    short: 'Задачи',
    where: 'Меню → Задачи',
    purpose: 'Поручения по работам: кто, что, на каком поле и к какому сроку.',
    howtos: [
      {
        title: 'Поставить задачу',
        steps: [
          '«Создать задачу» → название (обязательно).',
          'Исполнитель, поле, участники, приоритет, срок, тип работ, описание и файлы → сохранить.',
        ],
        result: 'Исполнитель и участники получат уведомление.',
        note: 'Сотрудник ставит задачи себе; назначать исполнителя может руководитель.',
      },
      {
        title: 'Вести задачу до конца',
        steps: [
          'Нажмите на задачу — откроется карточка.',
          'Меняйте статус по ходу: «К выполнению» → «В процессе» → «На проверке».',
          'Вопросы и итоги пишите в «Обсуждение», файлы прикрепляйте в карточке.',
          'Руководитель проверяет и ставит «Выполнено».',
        ],
      },
      {
        title: 'Найти нужные задачи',
        steps: [
          '«Все задачи» или «На мне», фильтры по сотруднику, статусу и сроку, поиск по номеру.',
          'Задачи на проверке и просроченные видны сразу на «Обзоре».',
        ],
      },
      {
        title: 'Открыть задачу на отдельной странице',
        steps: ['Нажмите на задачу с Ctrl (⌘ на Mac) или колёсиком мыши — она откроется в новой вкладке. Из карточки — значок рядом с крестиком.'],
      },
    ],
    shots: [{ src: '/about/task.webp', alt: 'Задача на отдельной странице' }],
    links: [{ label: 'Задачи', to: '/task-management' }],
  },
  {
    id: 'guide-calendar',
    icon: CalendarDaysIcon,
    title: 'Календарь',
    short: 'Календарь',
    where: 'Меню → Календарь',
    purpose: 'Встречи и договорённости по времени — отдельно от производственных задач.',
    howtos: [
      {
        title: 'Назначить встречу',
        steps: [
          '«Создать событие»: название, дата и время, приоритет, повтор, участники.',
          'Файлы прикрепляются после сохранения.',
        ],
        result: 'Участники получат приглашение в «Уведомлениях»; событие появится на «Обзоре» в день встречи.',
      },
      {
        title: 'Посмотреть расписание',
        steps: ['Виды «День», «Неделя», «Месяц» и «Расписание»; мини-календарь слева переключает дату.'],
        note: 'Руководитель может открыть календарь любого сотрудника.',
      },
    ],
    links: [{ label: 'Календарь', to: '/tasks' }],
  },
  {
    id: 'guide-equipment',
    icon: TractorIcon,
    title: 'Техника',
    short: 'Техника',
    where: 'Меню → Техника',
    purpose: 'Машины и навесные орудия с документами, фото и историей работы.',
    howtos: [
      {
        title: 'Добавить машину',
        steps: ['Вкладка «Техника» → «Добавить технику»: марка и госномер обязательны, остальное — по документам (VIN, ПСМ, СВР, даты регистрации).'],
      },
      {
        title: 'Добавить орудие',
        steps: ['Вкладка «Орудия» → «Добавить орудие»: плуг, сеялка и т. п. Орудие можно закрепить за машиной.'],
      },
      {
        title: 'Посмотреть, как работала машина',
        steps: ['Откройте машину: документы, фото и история — какие операции, топливо до и после, состояние.'],
      },
    ],
    shots: [{ src: '/about/equipment.webp', alt: 'Список техники' }],
    links: [{ label: 'Техника', to: '/equipment' }],
  },
  {
    id: 'guide-analytics',
    icon: BarChart3Icon,
    title: 'Обзор и аналитика',
    short: 'Обзор и аналитика',
    where: 'Меню → Обзор; Меню → Аналитика',
    purpose: '«Обзор» — что важно сегодня. «Аналитика» — итоги за период по уже введённым данным.',
    howtos: [
      {
        title: 'Начать день',
        steps: [
          'Меню → «Обзор»: непрочитанные сообщения и уведомления, ваши задачи (просроченные — первыми), события календаря на сегодня.',
          'Руководителю там же — задачи на проверке, кто сейчас в поле и сколько зерна на складах.',
        ],
      },
      {
        title: 'Посмотреть итоги за период',
        steps: [
          'Аналитика → выберите период: «Сегодня», «Неделя», «Месяц» или свои даты. Руководитель может выбрать сотрудника.',
          'Вверху — люди в полях, техника в работе, часы простоя, выполненные задачи (нажмите, чтобы открыть список).',
          'Ниже — активные поля, топливо и состояние техники, задачи по статусам и сотрудникам, операции по полям.',
        ],
      },
    ],
    links: [
      { label: 'Обзор', to: '/dashboard' },
      { label: 'Аналитика', to: '/reports' },
    ],
  },
  {
    id: 'guide-chat',
    icon: MessageCircleIcon,
    title: 'Чат, сотрудники и уведомления',
    short: 'Связь',
    where: 'Меню → Связь',
    purpose: 'Быстрая связь с коллегами и всё, что требует вашего внимания.',
    howtos: [
      {
        title: 'Написать коллеге',
        steps: [
          'Чат → «Написать» → выберите сотрудника.',
          'Enter — отправить, Shift+Enter — новая строка. Файл до 10 МБ — скрепкой у поля ввода.',
          'Своё сообщение можно удалить: правой кнопкой мыши, на телефоне — свайпом влево или долгим нажатием.',
        ],
        note: 'Групповой чат создаёт руководитель кнопкой «Новая команда».',
      },
      {
        title: 'Добавить сотрудника',
        steps: ['Сотрудники → «Добавить сотрудника»: ФИО, почта, телефон, должность, роль и пароль.', 'Нажмите на карточку сотрудника, чтобы изменить данные, отключить доступ или удалить.'],
        note: 'Только для руководителя.',
      },
      {
        title: 'Ничего не пропустить',
        steps: ['Число непрочитанных — в меню рядом с «Чат» и «Уведомления».', '«Уведомления» — назначенные задачи, приглашения, комментарии; фильтр «Не прочитано».'],
      },
    ],
    links: [
      { label: 'Чат', to: '/chat' },
      { label: 'Сотрудники', to: '/employees' },
      { label: 'Уведомления', to: '/notifications' },
    ],
  },
  {
    id: 'guide-news',
    icon: NewspaperIcon,
    title: 'Новости и погода',
    short: 'Новости и погода',
    where: 'Меню → Новости, Погода',
    purpose: 'Новости компании и условия для полевых работ.',
    howtos: [
      {
        title: 'Опубликовать новость',
        steps: [
          'Новости → «Добавить новость»: заголовок, подводка, обложка, текст (можно вставить прямо из источника), галерея.',
          '«Опубликовать сейчас» — сразу; «Сохранить» — с выбранной датой.',
        ],
        note: 'Только для руководителя.',
      },
      {
        title: 'Проверить погоду для работ',
        steps: ['Погода → выберите город: прогноз на 5 дней, агро-условия на сутки, почасовой риск работ и состояние на ваших полях.'],
      },
    ],
    shots: [{ src: '/about/weather.webp', alt: 'Погода и агро-условия' }],
    links: [
      { label: 'Новости', to: '/news' },
      { label: 'Погода', to: '/weather' },
    ],
  },
  {
    id: 'guide-settings',
    icon: BookMarkedIcon,
    title: 'Справочники и профиль',
    short: 'Справочники',
    where: 'Меню → Настройки; меню пользователя внизу слева',
    purpose: 'Списки, из которых выбирают в формах, и ваши личные данные.',
    howtos: [
      {
        title: 'Добавить значение в выпадающий список',
        when: 'В форме нет нужной культуры, типа или причины.',
        steps: [
          'Нажмите «?» рядом с полем — там прямая ссылка на нужный справочник.',
          'Или: Настройки → «Справочники» → нужная группа (права, земли, СХ культуры, мелиорация, техника, поля, севооборот, хранение).',
          'Причины простоя и операции для экрана оператора — в «Полях», вкладки «Причины простоя» и «Операции для работы».',
        ],
        result: 'Новое значение сразу появится в форме.',
      },
      { title: 'Изменить профиль или пароль', steps: ['Меню пользователя внизу слева → профиль: имя, контакты, должность, фото, смена пароля.'] },
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
      'Отменяет ошибочные складские документы',
      'Публикует новости, создаёт командные чаты',
      'Смотрит аналитику по всем или по конкретному сотруднику',
    ],
  },
  {
    title: 'Сотрудник',
    icon: UsersIcon,
    items: [
      'Отмечает работу на экране оператора: операции, простои, проблемы',
      'Ставит задачи себе, ведёт свои задачи и календарь',
      'Пишет в чат и получает уведомления',
      'Видит аналитику по своей работе',
    ],
  },
]

const tips = [
  { title: 'Звёздочка *', text: 'Поле обязательно. Пока оно пустое, кнопка сохранения неактивна.' },
  { title: 'Знак «?» у поля', text: 'Подсказка и ссылка на справочник, где добавить недостающее значение.' },
  { title: 'Телефон и планшет', text: 'Все разделы работают на телефоне; меню — кнопка слева вверху.' },
  { title: 'Тёмная тема', text: 'Значок луны или солнца справа вверху.' },
]

const faq = [
  { q: 'Почему зачётный вес меньше, чем на весах?', a: 'Влажное и засорённое зерно пересчитывается к сухому и чистому: сначала к базовой влажности культуры (обычно 14%), потом вычитаются сорная и зерновая примеси. В остаток идёт именно зачётный вес — расчёт виден внизу формы приёмки.' },
  { q: 'Не получается принять зерно в ячейку', a: 'В ячейке уже лежит другая культура или не хватает вместимости. Выберите другую ячейку или создайте новую кнопкой «Ячейка» в карточке склада.' },
  { q: 'Кнопки «Перемещение» и «Операция» неактивны', a: 'На складе пока нет зерна — сначала проведите приёмку.' },
  { q: 'Почему на экране оператора нельзя сменить поле', a: 'Пока идёт операция или простой, поле закреплено. Завершите работу — и выберите другое поле.' },
  { q: 'Кнопка «Сохранить» неактивна', a: 'Заполнены не все поля со звёздочкой. Если ошибку вернул сервер, окно само прокрутится к сообщению о ней.' },
  { q: 'Какой размер файлов можно прикреплять', a: 'В чат — до 10 МБ, к схеме поля — JPG, PNG или PDF до 20 МБ.' },
]
</script>

<template>
  <div class="tw-scope flex min-w-0 flex-col gap-6">
    <!-- Вступление -->
    <section class="grid gap-4 rounded-xl border bg-card p-4 shadow-xs md:p-6">
      <div class="grid gap-2">
        <h2 class="text-xl font-semibold md:text-2xl">Инструкция по порталу</h2>
        <p class="max-w-3xl text-sm text-muted-foreground md:text-base">
          В каждом разделе — для чего он нужен и пошаговые инструкции «Как сделать…». Нажмите на инструкцию, чтобы раскрыть шаги.
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
          {{ s.short }}
        </a>
        <a href="#guide-roles" class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted" @click="scrollToId('guide-roles', $event)">Роли</a>
        <a href="#guide-faq" class="rounded-full border px-3 py-1 text-sm text-foreground no-underline transition-colors hover:bg-muted" @click="scrollToId('guide-faq', $event)">Вопросы</a>
      </nav>
    </section>

    <!-- С чего начать -->
    <section id="guide-start" class="grid scroll-mt-4 gap-4">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold">С чего начать</h2>
        <p class="text-sm text-muted-foreground">Заполните разделы по порядку — тогда в формах везде будет выбор из готовых списков.</p>
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
    </section>

    <!-- Разделы -->
    <section
      v-for="s in sections"
      :id="s.id"
      :key="s.id"
      class="grid scroll-mt-4 gap-6 rounded-xl border bg-card p-4 shadow-xs md:p-6"
    >
      <div
        class="grid min-w-0 gap-6"
        :class="s.shots?.length ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start' : ''"
      >
        <div class="grid min-w-0 content-start gap-4">
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
        </div>

        <div v-if="s.shots?.length" class="flex min-w-0 items-start gap-4">
          <button
            v-for="shot in s.shots"
            :key="shot.src"
            type="button"
            class="group block min-w-0 cursor-zoom-in overflow-hidden border bg-muted/40 text-left shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50"
            :class="shot.phone ? 'hidden w-36 shrink-0 rounded-[1.25rem] p-1.5 sm:block' : 'flex-1 rounded-xl'"
            :aria-label="`Открыть снимок: ${shot.alt}`"
            @click="preview = shot"
          >
            <span v-if="!shot.phone" class="flex items-center gap-1.5 border-b bg-muted/60 px-3 py-2" aria-hidden="true">
              <span class="size-2 rounded-full bg-muted-foreground/30" />
              <span class="size-2 rounded-full bg-muted-foreground/30" />
              <span class="size-2 rounded-full bg-muted-foreground/30" />
            </span>
            <img
              :src="shot.src"
              :alt="shot.alt"
              loading="lazy"
              decoding="async"
              class="block h-auto w-full transition-transform duration-300 group-hover:scale-[1.01]"
              :class="shot.phone ? 'rounded-[0.9rem]' : ''"
            />
          </button>
        </div>
      </div>

      <!-- Склады: как устроено -->
      <template v-if="s.id === 'guide-stock'">
        <div class="grid gap-3">
          <h3 class="text-base font-semibold">Как устроено</h3>
          <ol class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <li v-for="(item, i) in stockScheme" :key="item.title" class="relative flex gap-3 rounded-lg border bg-background p-4">
              <component :is="item.icon" class="mt-0.5 size-5 shrink-0 text-primary dark:text-ring" />
              <span class="grid gap-1">
                <span class="text-sm font-medium">{{ item.title }}</span>
                <span class="text-sm text-muted-foreground">{{ item.text }}</span>
              </span>
              <ChevronRightIcon
                v-if="i < stockScheme.length - 1"
                class="absolute -right-3.5 top-1/2 z-10 hidden size-5 -translate-y-1/2 rounded-full border bg-card text-muted-foreground xl:block"
                aria-hidden="true"
              />
            </li>
          </ol>
          <p class="text-sm text-muted-foreground">
            Пример: на «Складе №1» есть ячейка «Силос 2», в ней лежит партия озимой пшеницы с поля №7 урожая 2026 года. Приняли зерно, продали часть — каждое действие стало документом в журнале.
          </p>
        </div>

        <div class="grid gap-3">
          <h3 class="text-base font-semibold">Главные правила</h3>
          <ul class="grid gap-2">
            <li v-for="rule in stockRules" :key="rule" class="flex gap-2 text-sm">
              <span class="mt-2 size-1.5 shrink-0 rounded-full bg-primary dark:bg-ring" aria-hidden="true" />
              {{ rule }}
            </li>
          </ul>
        </div>

        <div class="grid gap-2 rounded-lg bg-muted/60 p-4">
          <h3 class="text-sm font-semibold">Как считается зачётный вес при приёмке</h3>
          <p class="text-sm text-muted-foreground">
            Сырое и засорённое зерно пересчитывается к сухому и чистому. Пример для пшеницы с базовой влажностью 14%:
            привезли 30 т при влажности 18% → после сушки 30 × (100 − 18) / (100 − 14) = 28,6 т;
            примеси 2% + 1% = 0,9 т → в остаток пойдёт <strong class="font-medium text-foreground">27,7 т</strong>.
            Форма приёмки считает это сама и показывает внизу.
          </p>
        </div>
      </template>

      <div class="grid gap-3">
        <h3 class="text-base font-semibold">Инструкции</h3>
        <Accordion type="multiple" class="rounded-lg border px-4">
          <AccordionItem v-if="s.id === 'guide-stock'" value="setup">
            <AccordionTrigger class="text-left text-sm">{{ stockSetup.title }}</AccordionTrigger>
            <AccordionContent>
              <ol class="grid gap-2">
                <li v-for="(step, i) in stockSetup.steps" :key="i" class="flex gap-3 text-sm leading-relaxed">
                  <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">{{ i + 1 }}</span>
                  <span>{{ step }}</span>
                </li>
              </ol>
              <p class="mt-3 text-sm text-muted-foreground"><span class="font-medium text-foreground">Итог:</span> {{ stockSetup.result }}</p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem v-for="(h, hi) in s.howtos" :key="h.title" :value="`h-${hi}`">
            <AccordionTrigger class="text-left text-sm">Как {{ h.title.charAt(0).toLowerCase() + h.title.slice(1) }}</AccordionTrigger>
            <AccordionContent class="grid gap-3">
              <p v-if="h.when" class="text-sm text-muted-foreground">{{ h.when }}</p>
              <ol class="grid gap-2">
                <li v-for="(step, i) in h.steps" :key="i" class="flex gap-3 text-sm leading-relaxed">
                  <span class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums text-muted-foreground">{{ i + 1 }}</span>
                  <span>{{ step }}</span>
                </li>
              </ol>
              <p v-if="h.result" class="text-sm text-muted-foreground"><span class="font-medium text-foreground">Итог:</span> {{ h.result }}</p>
              <p v-if="h.note" class="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">{{ h.note }}</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>

    <!-- Роли -->
    <section id="guide-roles" class="grid scroll-mt-4 gap-4">
      <div class="grid gap-1">
        <h2 class="text-lg font-semibold">Роли</h2>
        <p class="text-sm text-muted-foreground">Роль назначает руководитель при добавлении сотрудника.</p>
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
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

    <!-- Автор портала -->
    <section class="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:flex-row sm:items-center md:p-6" aria-labelledby="guide-author">
      <img src="/about/author.webp" width="80" height="80" alt="Фото автора портала" loading="lazy" decoding="async" class="size-20 shrink-0 rounded-full border object-cover" />
      <div class="grid min-w-0 gap-1">
        <h2 id="guide-author" class="text-base font-semibold">Связь с автором</h2>
        <p class="text-sm text-muted-foreground">Вопросы, предложения и ошибки в работе портала — пишите напрямую.</p>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a href="mailto:aliyartalybov@icloud.com" class="font-medium text-primary no-underline hover:underline dark:text-ring">aliyartalybov@icloud.com</a>
          <a href="https://t.me/aliyarMSK" target="_blank" rel="noopener noreferrer" class="font-medium text-primary no-underline hover:underline dark:text-ring">Telegram: @aliyarMSK</a>
        </div>
      </div>
      <p class="text-xs text-muted-foreground sm:ml-auto sm:text-right">АГРОСИСТЕМА — 2026</p>
    </section>

    <ImagePreviewDialog v-if="preview" :name="preview.alt" :url="preview.src" @close="preview = null" />

    <p class="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
      <BellIcon class="size-4" />
      Если что-то работает не так, как описано, — напишите руководителю или в ИТ-отдел через чат.
    </p>
  </div>
</template>
