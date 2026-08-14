import { fetchWeather, getWeatherIconUrl } from "./weather-api.js";

// ——— Тема (светлая как на макете / тёмная старая) ———
const THEME_STORAGE_KEY = "agro_ctrl:theme";

function getStoredTheme() {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function initThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  const initial = getStoredTheme();
  applyTheme(initial);

  if (!btn) return;

  function syncLabel() {
    const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const iconEl = btn.querySelector(".theme-toggle-icon");
    const labelEl = btn.querySelector(".theme-toggle-label");
    if (!iconEl || !labelEl) return;

    if (theme === "dark") {
      iconEl.textContent = "☀️";
      labelEl.textContent = "Светлая тема";
    } else {
      iconEl.textContent = "🌙";
      labelEl.textContent = "Тёмная тема";
    }
  }

  syncLabel();

  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    syncLabel();
  });
}

const fields = [
  {
    id: "field-5",
    name: "Поле #5",
    area: 120,
    cropKey: "wheat",
    cropName: "Пшеница",
    stage: "Восковая спелость",
    readinessPercent: 85,
    forecastYield: "45 ц/га",
    harvestDate: "12.08",
    imageUrl:
      "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "field-12",
    name: "Поле #12",
    area: 85,
    cropKey: "corn",
    cropName: "Кукуруза",
    stage: "Цветение",
    readinessPercent: 40,
    forecastYield: "72 ц/га",
    harvestDate: "25.09",
    imageUrl:
      "https://images.unsplash.com/photo-1594488344604-037042831a29?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "field-3",
    name: "Поле #3",
    area: 210,
    cropKey: "soy",
    cropName: "Соя",
    stage: "Налив бобов",
    readinessPercent: 60,
    forecastYield: "28 ц/га",
    harvestDate: "05.09",
    imageUrl:
      "https://images.unsplash.com/photo-1530507629858-e4977d30e9e0?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "field-8",
    name: "Поле #8",
    area: 155,
    cropKey: "sunflower",
    cropName: "Подсолнечник",
    stage: "Созревание",
    readinessPercent: 92,
    forecastYield: "34 ц/га",
    harvestDate: "15.08",
    imageUrl:
      "https://images.unsplash.com/photo-1464303350174-88981f335b71?auto=format&fit=crop&w=400&q=80",
  },
  {
    id: "field-21",
    name: "Поле #21",
    area: 64,
    cropKey: "wheat",
    cropName: "Пшеница",
    stage: "Кущение",
    readinessPercent: 22,
    forecastYield: "39 ц/га",
    harvestDate: "30.09",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=400&q=80",
  },
];

const STORAGE_KEYS = {
  lastSelectedFieldId: "agro_ctrl:lastSelectedFieldId",
  cropFilter: "agro_ctrl:cropFilter",
};

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function initNavigation() {
  const navButtons = $all(".nav-item");
  const sections = $all(".page-section");

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetSection = btn.dataset.section;

      navButtons.forEach((b) => b.classList.toggle("active", b === btn));

      sections.forEach((section) => {
        const isActive = section.dataset.section === targetSection;
        section.hidden = !isActive;
      });
    });
  });
}

function renderFieldCard(field) {
  const card = document.createElement("article");
  card.className = "field-card";
  card.dataset.fieldId = field.id;
  card.innerHTML = `
    <div class="field-image" style="background-image: url('${field.imageUrl}')">
      <span class="crop-badge">${field.cropName}</span>
    </div>
    <div class="field-info">
      <div>
        <div class="type-label">${field.name} • ${field.area} Га</div>
        <div class="type-value">${field.stage}</div>
      </div>
      <div>
        <div class="type-label mb-1">Готовность к уборке: ${field.readinessPercent}%</div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${field.readinessPercent}%"></div>
        </div>
      </div>
      <div class="stats-row">
        <div>
          <div class="type-label">Прогноз урожайности</div>
          <div class="type-value">${field.forecastYield}</div>
        </div>
        <div style="text-align: right">
          <div class="type-label">Окно уборки</div>
          <div class="type-value">${field.harvestDate}</div>
        </div>
      </div>
    </div>
  `;

  return card;
}

function updateFieldDetails(field) {
  const container = $("#field-details");
  if (!field) {
    container.innerHTML = `
      <div class="type-label mb-1">Выбранное поле</div>
      <div class="field-details-empty">
        Выберите поле на схеме или из списка справа, чтобы увидеть детальную информацию
        и возможные операции.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="field-details-header">
      <div>
        <div class="type-label mb-1">${field.name} • ${field.area} Га</div>
        <div class="type-value">${field.cropName} — ${field.stage}</div>
      </div>
      <span class="pill">
        <span class="pill-dot"></span>
        ${field.readinessPercent}% готовности
      </span>
    </div>

    <div class="field-details-main">
      <div>
        <div class="type-label mb-1">Прогноз урожайности</div>
        <div class="type-value">${field.forecastYield}</div>
      </div>
      <div>
        <div class="type-label mb-1">Плановая дата уборки</div>
        <div class="type-value">${field.harvestDate}</div>
      </div>
      <div>
        <div class="type-label mb-1">Статус поля</div>
        <div class="type-value">
          ${
            field.readinessPercent >= 80
              ? "Готово к уборке"
              : field.readinessPercent >= 50
              ? "В активной вегетации"
              : "Ранняя стадия"
          }
        </div>
      </div>
    </div>

    <div class="field-details-actions">
      <button class="btn btn-primary" type="button" data-action="plan-harvest">
        Запланировать уборку
      </button>
      <button class="btn btn-ghost" type="button" data-action="open-journal">
        Открыть журнал работ
      </button>
      <button class="btn btn-ghost" type="button" data-action="open-reports">
        Перейти к отчётам
      </button>
    </div>
  `;

  const actionsContainer = container.querySelector(".field-details-actions");
  actionsContainer.addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) return;
    const action = target.dataset.action;

    if (action === "open-journal") {
      switchSection("journal");
    } else if (action === "open-reports") {
      switchSection("reports");
    }
  });
}

function switchSection(sectionId) {
  const navButtons = $all(".nav-item");
  const sections = $all(".page-section");

  navButtons.forEach((btn) => {
    const isTarget = btn.dataset.section === sectionId;
    btn.classList.toggle("active", isTarget);
  });

  sections.forEach((section) => {
    const isActive = section.dataset.section === sectionId;
    section.hidden = !isActive;
  });
}

function applyFilterAndSearch({ cropFilter, searchText }) {
  const normalizedSearch = searchText.trim().toLowerCase();
  const cards = $all(".field-card");
  const polygons = $all(".field-polygon");

  cards.forEach((card) => {
    const fieldId = card.dataset.fieldId;
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    const matchesCrop =
      cropFilter === "all" ? true : field.cropKey === cropFilter;

    const haystack = `${field.name} ${field.cropName} ${field.stage}`.toLowerCase();
    const matchesSearch = normalizedSearch
      ? haystack.includes(normalizedSearch)
      : true;

    const visible = matchesCrop && matchesSearch;
    card.style.display = visible ? "" : "none";
  });

  polygons.forEach((poly) => {
    const fieldId = poly.dataset.fieldId;
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    const matchesCrop =
      cropFilter === "all" ? true : field.cropKey === cropFilter;

    const haystack = `${field.name} ${field.cropName} ${field.stage}`.toLowerCase();
    const matchesSearch = normalizedSearch
      ? haystack.includes(normalizedSearch)
      : true;

    const visible = matchesCrop && matchesSearch;
    poly.classList.toggle("is-dimmed", !visible);
  });
}

function initFieldsSection() {
  const listContainer = $("#field-list");
  const polygons = $all(".field-polygon");
  const cropFilterEl = $("#crop-filter");
  const searchInput = $("#field-search");

  fields.forEach((field) => {
    const card = renderFieldCard(field);
    listContainer.appendChild(card);
  });

  let selectedId =
    window.localStorage.getItem(STORAGE_KEYS.lastSelectedFieldId) || null;
  let currentFilter =
    window.localStorage.getItem(STORAGE_KEYS.cropFilter) || "all";

  const initialFilterChip = cropFilterEl.querySelector(
    `[data-crop="${currentFilter}"]`,
  );
  if (initialFilterChip) {
    $all(".chip", cropFilterEl).forEach((chip) =>
      chip.classList.toggle("chip-active", chip === initialFilterChip),
    );
  } else {
    currentFilter = "all";
  }

  applyFilterAndSearch({ cropFilter: currentFilter, searchText: "" });

  function markSelected(fieldId) {
    selectedId = fieldId;
    window.localStorage.setItem(STORAGE_KEYS.lastSelectedFieldId, fieldId);

    const cards = $all(".field-card");
    const polys = $all(".field-polygon");

    cards.forEach((card) =>
      card.classList.toggle("is-active", card.dataset.fieldId === fieldId),
    );

    polys.forEach((poly) =>
      poly.classList.toggle("is-active", poly.dataset.fieldId === fieldId),
    );

    const field = fields.find((f) => f.id === fieldId);
    updateFieldDetails(field || null);
  }

  listContainer.addEventListener("click", (event) => {
    const card = event.target.closest(".field-card");
    if (!card) return;

    markSelected(card.dataset.fieldId);

    const poly = document.querySelector(
      `.field-polygon[data-field-id="${card.dataset.fieldId}"]`,
    );
    if (poly) {
      poly.focus?.();
    }
  });

  polygons.forEach((poly) => {
    poly.setAttribute("tabindex", "0");
    poly.addEventListener("click", () => {
      const fieldId = poly.dataset.fieldId;
      markSelected(fieldId);

      const card = document.querySelector(
        `.field-card[data-field-id="${fieldId}"]`,
      );
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    poly.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        poly.click();
      }
    });
  });

  cropFilterEl.addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const crop = chip.dataset.crop;
    if (!crop) return;

    currentFilter = crop;
    window.localStorage.setItem(STORAGE_KEYS.cropFilter, crop);

    $all(".chip", cropFilterEl).forEach((c) =>
      c.classList.toggle("chip-active", c === chip),
    );

    applyFilterAndSearch({
      cropFilter: currentFilter,
      searchText: searchInput.value || "",
    });
  });

  let searchTimeout = null;
  searchInput.addEventListener("input", () => {
    if (searchTimeout) {
      window.clearTimeout(searchTimeout);
    }
    searchTimeout = window.setTimeout(() => {
      applyFilterAndSearch({
        cropFilter: currentFilter,
        searchText: searchInput.value || "",
      });
    }, 150);
  });

  if (selectedId && fields.some((f) => f.id === selectedId)) {
    markSelected(selectedId);
  } else {
    const first = fields[0];
    if (first) {
      markSelected(first.id);
    }
  }
}

// ——— Погода: состояние и отрисовка ———
let weatherData = null;
const DEFAULT_WEATHER_CITY = "Kursk";
const DEFAULT_WEATHER_COUNTRY = "ru";

function formatWeatherTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms * 1000);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function renderWeatherCompact(data) {
  const loading = $("#weather-compact-loading");
  const content = $("#weather-compact-content");
  const err = $("#weather-compact-error");
  if (!loading || !content || !err) return;

  if (!data) {
    loading.hidden = true;
    content.hidden = true;
    err.hidden = false;
    return;
  }

  loading.hidden = true;
  err.hidden = true;
  content.hidden = false;

  const windSpeed = data.windSpeed != null ? data.windSpeed : 0;
  const windClass = windSpeed > 10 ? "weather-extreme" : windSpeed > 5 ? "weather-wind-warning" : "";
  const temp = data.temp != null ? data.temp : "—";
  const tempExtreme = temp !== "—" && (temp < -15 || temp > 35);
  const tempClass = tempExtreme ? "weather-extreme" : "";

  content.innerHTML = `
    <span class="weather-compact-city">${escapeHtml(data.cityName)}</span>
    <span class="weather-compact-temp ${tempClass}">${temp}°C</span>
    <img class="weather-compact-icon" src="${getWeatherIconUrl(data.icon)}" alt="" />
    <div>
      <div class="weather-compact-desc">${escapeHtml(data.description)}</div>
      <div class="weather-compact-feels">Ощущается как ${data.feelsLike != null ? data.feelsLike : "—"}°C</div>
      <div class="weather-compact-meta">
        <span>Влажность: ${data.humidity != null ? data.humidity + "%" : "—"}</span>
        <span class="${windClass}">Ветер: ${windSpeed !== null && windSpeed !== undefined ? windSpeed + " м/с" : "—"}</span>
      </div>
    </div>
  `;
}

function renderWeatherDetail(data) {
  const loading = $("#weather-detail-loading");
  const err = $("#weather-detail-error");
  const content = $("#weather-detail-content");
  const currentBlock = $("#weather-current-block");
  const paramsGrid = $("#weather-params-grid");
  const cropsList = $("#weather-crops-list");
  const fieldsList = $("#weather-fields-list");
  if (!content || !currentBlock || !paramsGrid || !cropsList || !fieldsList) return;

  if (!data) {
    if (loading) loading.hidden = true;
    if (err) err.hidden = false;
    content.hidden = true;
    return;
  }

  if (loading) loading.hidden = true;
  if (err) err.hidden = true;
  content.hidden = false;

  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const windSpeed = data.windSpeed != null ? data.windSpeed : 0;
  const windStrong = windSpeed > 5;
  const windExtreme = windSpeed > 10;
  const temp = data.temp != null ? data.temp : null;
  const tempExtreme = temp !== null && (temp < -15 || temp > 35);

  const updatedAt = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  currentBlock.innerHTML = `
    <div class="weather-current-main">
      <div class="weather-current-city">${escapeHtml(data.cityName)}</div>
      <div class="weather-current-datetime">Данные OpenWeatherMap · Обновлено ${updatedAt}</div>
      <div class="weather-current-datetime">${dateStr}, ${timeStr}</div>
      <div class="weather-current-temp-wrap">
        <span class="weather-current-temp ${tempExtreme ? "weather-extreme" : ""}">${temp != null ? temp : "—"}°C</span>
        <img class="weather-current-icon" src="${getWeatherIconUrl(data.icon)}" alt="" />
      </div>
      <div class="weather-current-desc">${escapeHtml(data.description)}</div>
      <div class="weather-current-feels">Ощущается как ${data.feelsLike != null ? data.feelsLike : "—"}°C</div>
      <div class="weather-current-extra">
        <span>Давление ${data.pressure != null ? data.pressure + " гПа" : "—"}</span>
        <span>Видимость ${data.visibility != null ? (data.visibility / 1000) + " км" : "—"}</span>
        <span>Облачность ${data.clouds != null ? data.clouds + "%" : "—"}</span>
      </div>
    </div>
    <div class="weather-current-coords">
      <span class="weather-param-label">Координаты</span>
      <div class="weather-param-value">Широта: ${data.coord?.lat != null ? data.coord.lat.toFixed(2) + "°" : "—"}, Долгота: ${data.coord?.lon != null ? data.coord.lon.toFixed(2) + "°" : "—"}</div>
    </div>
  `;

  paramsGrid.innerHTML = `
    <div class="weather-param-card">
      <div class="weather-param-label">Ветер</div>
      <div class="weather-param-value ${windExtreme ? "weather-extreme" : windStrong ? "weather-wind-warning" : ""}">${windSpeed !== null && windSpeed !== undefined ? windSpeed + " м/с" : "—"} ${data.windDirection ? data.windDirection : ""}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Направление ветра</div>
      <div class="weather-param-value">${data.windDeg != null ? data.windDeg + "°" : "—"} ${escapeHtml(data.windDirection || "")}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Влажность</div>
      <div class="weather-param-value">${data.humidity != null ? data.humidity + "%" : "—"}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Давление (уровень моря)</div>
      <div class="weather-param-value">${data.seaLevel != null ? data.seaLevel + " гПа" : data.pressure != null ? data.pressure + " гПа" : "—"}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Давление (у земли)</div>
      <div class="weather-param-value">${data.grndLevel != null ? data.grndLevel + " гПа" : "—"}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Восход / закат</div>
      <div class="weather-param-value">${data.sunrise || "—"} — ${data.sunset || "—"}</div>
    </div>
    <div class="weather-param-card">
      <div class="weather-param-label">Координаты</div>
      <div class="weather-param-value">${data.coord?.lat != null ? data.coord.lat.toFixed(2) + "°" : "—"} ${data.coord?.lon != null ? data.coord.lon.toFixed(2) + "°" : ""}</div>
    </div>
  `;

  const recommendations = getCropRecommendations(data);
  cropsList.innerHTML = recommendations
    .map(
      (r) => `
    <div class="weather-crop-item">
      <div class="weather-crop-icon ${r.key}">${r.icon}</div>
      <div>
        <div class="type-value">${escapeHtml(r.name)}</div>
        <span class="weather-crop-status ${r.statusClass}">${escapeHtml(r.status)}</span>
        <p class="weather-crop-desc" style="margin:8px 0 0 0;font-size:0.85rem;color:var(--text-secondary);">${escapeHtml(r.text)}</p>
      </div>
    </div>
  `
    )
    .join("");

  const fieldWeatherList = getFieldsWithMiniWeather(data);
  fieldsList.innerHTML = fieldWeatherList
    .map(
      (f) => `
    <div class="weather-field-mini">
      <div>
        <div class="weather-field-mini-name">${escapeHtml(f.name)}</div>
        <div class="weather-field-mini-crop">${escapeHtml(f.cropName)}</div>
      </div>
      <div class="weather-field-mini-weather">
        <img src="${getWeatherIconUrl(data.icon)}" alt="" width="28" height="28" />
        <span class="weather-field-mini-temp">${f.temp}°C</span>
        <span class="weather-field-mini-wind ${f.windStrong ? "wind-strong" : ""}">Ветер ${f.wind} м/с</span>
      </div>
    </div>
  `
    )
    .join("");
}

function getCropRecommendations(data) {
  const temp = data.temp != null ? data.temp : 15;
  const wind = data.windSpeed != null ? data.windSpeed : 0;
  const humidity = data.humidity != null ? data.humidity : 50;

  return [
    {
      key: "wheat",
      name: "Пшеница озимая",
      icon: "🌾",
      statusClass: temp >= 0 && temp <= 25 && wind < 10 ? "ok" : temp < -5 ? "risk" : "warn",
      status: temp >= 0 && temp <= 25 && wind < 10 ? "Комфортно" : temp < -5 ? "Риск" : "Ожидание",
      text:
        temp >= 0 && temp <= 25 && wind < 10
          ? "Температурный режим оптимален. Рекомендуется плановый осмотр всходов."
          : temp < -5
          ? "Возможны морозы. Контроль состояния озимых."
          : "Температура на границе нормы. Отложите внесение удобрений при ветре >5 м/с.",
    },
    {
      key: "sunflower",
      name: "Подсолнечник",
      icon: "🌻",
      statusClass: temp >= 10 && temp <= 28 ? "ok" : temp < 8 ? "warn" : "risk",
      status: temp >= 10 && temp <= 28 ? "Комфортно" : temp < 8 ? "Ожидание" : "Риск заморозков",
      text:
        temp >= 10 && temp <= 28
          ? "Условия благоприятны для посева и вегетации."
          : temp < 8
          ? "Почва недостаточно прогрета. Ожидайте повышения ночных температур."
          : "Риск ночных заморозков. Отложите посев.",
    },
    {
      key: "corn",
      name: "Кукуруза",
      icon: "🌽",
      statusClass: temp >= 10 && wind < 8 ? "ok" : temp < 8 ? "warn" : "risk",
      status: temp >= 10 && wind < 8 ? "Подготовка" : temp < 8 ? "Ожидание" : "Риск",
      text:
        temp >= 10 && wind < 8
          ? "Условия благоприятны для подготовки техники к началу посевной кампании."
          : temp < 8
          ? "Ожидается ночное понижение температуры. Риск повреждения всходов возвратными заморозками."
          : "Сильный ветер. Не рекомендуется опрыскивание.",
    },
  ];
}

function getFieldsWithMiniWeather(data) {
  const temp = data.temp != null ? data.temp : 0;
  const wind = data.windSpeed != null ? data.windSpeed : 0;
  return fields.map((f, i) => {
    const offset = (i % 3) - 1;
    return {
      name: f.name,
      cropName: f.cropName,
      temp: temp + offset,
      wind: Math.min(15, Math.max(0, wind + (i % 2))),
      windStrong: wind + (i % 2) > 5,
    };
  });
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function loadWeather(city, country) {
  const loadingCompact = $("#weather-compact-loading");
  const loadingDetail = $("#weather-detail-loading");
  if (loadingCompact) loadingCompact.hidden = false;
  if (loadingDetail) loadingDetail.hidden = false;
  $("#weather-compact-error")?.setAttribute("hidden", "");
  $("#weather-detail-error")?.setAttribute("hidden", "");
  $("#weather-compact-content")?.setAttribute("hidden", "");

  fetchWeather(city, country).then((data) => {
    weatherData = data;
    if (loadingCompact) loadingCompact.hidden = true;
    if (loadingDetail) loadingDetail.hidden = true;
    renderWeatherCompact(data);
    renderWeatherDetail(data);
    if (!data) {
      $("#weather-compact-error")?.removeAttribute("hidden");
      $("#weather-detail-error")?.removeAttribute("hidden");
    }
  });
}

function initWeatherSection() {
  const citySelect = $("#weather-city-select");
  const refreshBtn = $("#weather-refresh-btn");
  if (citySelect) {
    citySelect.addEventListener("change", () => {
      const [city, country] = citySelect.value.split(",");
      loadWeather(city, country);
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      const [city, country] = (citySelect?.value || "Kursk,ru").split(",");
      loadWeather(city, country);
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initNavigation();
  initFieldsSection();
  initWeatherSection();
  loadWeather(DEFAULT_WEATHER_CITY, DEFAULT_WEATHER_COUNTRY);
});

