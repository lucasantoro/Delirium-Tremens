const SITE_ROOT = new URL("../", window.location.href);
const MANIFEST_URL = new URL("data/guides-manifest.json", SITE_ROOT);
const state = { manifest: null, activeCategory: "all" };

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add("page-loaded");
  await loadGuideLibrary();
});

async function loadGuideLibrary() {
  const container = document.getElementById("guide-library");
  try {
    const response = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("Indice guide non disponibile");
    state.manifest = await response.json();
    renderCategoryTabs();
    renderGuideLibrary();
  } catch (error) {
    console.error("Errore guide:", error);
    container.innerHTML = '<div class="empty-state">Impossibile caricare la biblioteca delle guide.</div>';
  }
}

function renderCategoryTabs() {
  const tabs = document.getElementById("guide-category-tabs");
  const categories = state.manifest?.categories || [];
  const options = [{ id: "all", title: "Tutte" }, ...categories];
  tabs.innerHTML = options.map(category => `
    <button class="guide-category-tab ${category.id === state.activeCategory ? "is-active" : ""}"
      type="button" role="tab" aria-selected="${category.id === state.activeCategory}"
      data-guide-category="${escapeHtml(category.id)}">${escapeHtml(category.title)}</button>
  `).join("");
  tabs.querySelectorAll("[data-guide-category]").forEach(button => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.guideCategory;
      renderCategoryTabs();
      renderGuideLibrary();
    });
  });
}

function renderGuideLibrary() {
  const container = document.getElementById("guide-library");
  const allGuides = state.manifest?.guides || [];
  const guides = state.activeCategory === "all" ? allGuides : allGuides.filter(guide => guide.type === state.activeCategory);
  container.innerHTML = guides.length ? renderGuideGroups(guides) : '<div class="empty-state">Nessuna guida disponibile in questa categoria.</div>';
  bindInternalTransitions(container);
}

function renderGuideGroups(guides) {
  const groups = [
    { id: "achievement", eyebrow: "Guide di gilda", title: "Achievement e collezioni", description: "Guide organizzate boss per boss, checklist e obiettivi di gilda.", matches: guide => guide.type === "achievement" },
    { id: "fights", eyebrow: "Raid toolkit", title: "Guide ai fight", description: "Strategie dei boss e manuali Normal e Heroic.", matches: guide => guide.type === "raid" && (!guide.section || guide.section === "fights") },
    { id: "preparation", eyebrow: "Raid toolkit", title: "Preparazione prima del raid", description: "Attività e procedure da completare prima di entrare in istanza.", matches: guide => guide.type === "raid" && guide.section === "preparation" },
    { id: "addons", eyebrow: "Raid toolkit", title: "Addon obbligatori", description: "La configurazione minima richiesta a ogni raider.", matches: guide => guide.type === "raid" && guide.section === "addons" }
  ];

  return groups.map(group => {
    const items = guides.filter(group.matches);
    if (!items.length) return "";
    return `
      <section class="guide-library-group" data-guide-group="${group.id}">
        <div class="guide-library-group__head"><div><span>${group.eyebrow}</span><h3>${group.title}</h3></div><p>${group.description}</p></div>
        <div class="guide-card-grid">${items.map(renderGuideCard).join("")}</div>
      </section>
    `;
  }).join("");
}

function renderGuideCard(guide) {
  const href = resolveAsset(guide.href);
  const metaLeft = guide.expansion || (guide.type === "raid" ? "Raid" : "Achievement");
  const metaRight = guide.instance || guide.badge || "Guida";
  const cover = guide.coverImage
    ? `<img src="${escapeHtml(resolveAsset(guide.coverImage))}" alt="${escapeHtml(guide.title)}" loading="lazy">`
    : `<div class="guide-card__book" aria-hidden="true"><span>BJ</span><strong>${escapeHtml(guide.type === "raid" ? "RAID" : "GUIDA")}</strong></div>`;
  const detail = guide.type === "raid" && guide.pages
    ? `${guide.pages} pagine - PDF`
    : guide.updated ? `Aggiornata ${formatDate(guide.updated)}` : guide.badge || "Guida";
  const actionLabel = guide.section === "addons" ? "Vedi gli addon" : guide.type === "raid" ? "Leggi la guida" : "Apri guida";
  return `
    <article class="guide-card ${guide.type === "raid" ? "guide-card--raid" : "guide-card--feature"}">
      <a class="guide-card__media" href="${escapeHtml(href)}" aria-label="Apri ${escapeHtml(guide.title)}">
        ${cover}<span class="guide-card__format">${escapeHtml(detail)}</span>
      </a>
      <div class="guide-card__body">
        <div class="editorial-card__meta"><span>${escapeHtml(metaLeft)}</span><strong>${escapeHtml(metaRight)}</strong></div>
        <h3>${escapeHtml(guide.title)}</h3>
        <p>${escapeHtml(guide.summary || guide.subtitle || "Guida della gilda.")}</p>
        <div class="guide-card__actions"><a href="${escapeHtml(href)}" class="team-btn">${actionLabel}</a></div>
      </div>
    </article>
  `;
}

function bindInternalTransitions(scope) {
  scope.querySelectorAll("a").forEach(link => {
    if (link.hostname !== window.location.hostname) return;
    link.addEventListener("click", event => {
      event.preventDefault();
      document.body.classList.remove("page-loaded");
      setTimeout(() => { window.location.href = link.href; }, 220);
    });
  });
}

function resolveAsset(value) { return new URL(value, SITE_ROOT).href; }
function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("it-IT");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
