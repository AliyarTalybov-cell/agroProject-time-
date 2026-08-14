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

window.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initFieldsSection();
});

