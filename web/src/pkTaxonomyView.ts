// Chegga Web — browsable/filterable view of pkTaxonomy.ts.
//
// Direct follow-up to shipping the taxonomy design doc: the user wants it
// "on the Chegga Web website," not just in a one-off standalone page, so
// visitors (and the user) can sift through the 74 draft PK nodes without
// opening the vault's markdown doc. This is browse-only -- no puzzle
// content is wired to these nodes yet (see pkTaxonomy.ts's header comment
// and pk-mastery-system.md's "what happens next": the Lichess theme -> PK
// mapping table is the next step, not this view).

import { PK_NODES, PK_DOMAIN_INFO, PK_LEVEL_LABEL, type PkDomain, type PkNode } from "./pkTaxonomy";
import { lichessThemesForPkCode } from "./pkPuzzleMap";

const DOMAIN_ORDER: PkDomain[] = ["BV", "TC", "EG", "ST", "OP"];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Renders the static shell (search box, domain chips, level slider, and
 * one section per domain with its nodes as cards) -- filtering itself
 * happens client-side in `wireTaxonomyBrowser` below, matching the pure
 * add/remove-a-class approach `collapsibleCards.ts` uses elsewhere rather
 * than re-rendering the whole tree on every keystroke. */
export function renderTaxonomyBrowser(): string {
  const chips = ['<button type="button" class="pk-chip" data-domain="all" data-active="true">All domains</button>']
    .concat(
      DOMAIN_ORDER.map(
        (d) => `<button type="button" class="pk-chip" data-domain="${d}">${PK_DOMAIN_INFO[d].name}</button>`,
      ),
    )
    .join("");

  const sections = DOMAIN_ORDER.map((domain) => {
    const info = PK_DOMAIN_INFO[domain];
    const nodes = PK_NODES.filter((n) => n.domain === domain);
    const cards = nodes.map((n) => renderNodeCard(n)).join("");
    return `
      <div class="pk-domain-section" data-domain-section="${domain}">
        <div class="pk-domain-head">
          <span class="pk-domain-swatch" data-domain-swatch="${domain}"></span>
          <h3>${esc(info.name)}</h3>
          <span class="pk-domain-count" data-domain-count="${domain}">${nodes.length}/${nodes.length}</span>
        </div>
        ${info.note ? `<p class="pk-domain-note">${esc(info.note)}</p>` : ""}
        <div class="pk-node-grid">${cards}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="pk-controls">
      <div class="pk-controls-row">
        <label for="pk-search" class="sr-only">Search the taxonomy</label>
        <input type="text" id="pk-search" placeholder="Search a concept or code, e.g. &quot;fork&quot;, &quot;Lucena&quot;, &quot;TC-30&quot;…" />
        <div class="pk-chip-group" id="pk-domain-chips">${chips}</div>
      </div>
      <div class="pk-controls-row">
        <label for="pk-level-slider">Max rating tier</label>
        <input type="range" id="pk-level-slider" min="10" max="50" step="10" value="50" />
        <span id="pk-level-value" class="status-line">2200+</span>
        <span class="status-line" style="margin-left:auto"><strong id="pk-match-count">${PK_NODES.length}</strong> of ${PK_NODES.length} nodes shown</span>
      </div>
    </div>
    <div id="pk-sections">${sections}</div>
    <p class="status-line" id="pk-empty" style="display:none">No nodes match — try clearing the search or moving the slider.</p>
  `;
}

function renderNodeCard(n: PkNode): string {
  const prereqHtml = n.prereqs.length
    ? n.prereqs.map((p) => `<button type="button" class="pk-pill" data-jump="${p}">${p}</button>`).join("")
    : `<span class="pk-pill pk-pill-root">entry point</span>`;

  const themes = lichessThemesForPkCode(n.code);
  const practiceHtml = themes
    ? `<button type="button" class="pk-practice-btn" data-practice-code="${n.code}">Practice this ▸</button>`
    : "";

  return `
    <div class="pk-node-card" id="pk-node-${n.code}" data-domain="${n.domain}" data-level="${n.level}" data-search="${esc((n.code + " " + n.name).toLowerCase())}">
      <div class="pk-node-top">
        <span class="pk-node-code">${n.code}</span>
        <span class="pk-node-level" data-domain-text="${n.domain}">${PK_LEVEL_LABEL[n.level]}</span>
      </div>
      <p class="pk-node-name">${esc(n.name)}</p>
      <div class="pk-node-prereqs">${prereqHtml}</div>
      ${practiceHtml}
    </div>
  `;
}

/** Attaches search/filter/jump behavior. Call once after
 * `renderTaxonomyBrowser()`'s HTML is in the DOM -- idempotent guard via
 * a data attribute isn't needed since this section is only ever rendered
 * once (unlike focus-output, this content is static, not re-rendered per
 * refreshProfile). */
export function wireTaxonomyBrowser(
  root: HTMLElement,
  onPractice?: (pkCode: string, themes: string[], nodeName: string) => void,
): void {
  const search = root.querySelector<HTMLInputElement>("#pk-search")!;
  const chipsWrap = root.querySelector<HTMLElement>("#pk-domain-chips")!;
  const slider = root.querySelector<HTMLInputElement>("#pk-level-slider")!;
  const levelValue = root.querySelector<HTMLElement>("#pk-level-value")!;
  const matchCount = root.querySelector<HTMLElement>("#pk-match-count")!;
  const emptyEl = root.querySelector<HTMLElement>("#pk-empty")!;
  const sectionsEl = root.querySelector<HTMLElement>("#pk-sections")!;

  let activeDomain = "all";
  let maxLevel = 50;

  function applyFilters() {
    const query = search.value.trim().toLowerCase();
    let shown = 0;

    for (const domain of DOMAIN_ORDER) {
      const sectionEl = sectionsEl.querySelector<HTMLElement>(`[data-domain-section="${domain}"]`)!;
      const domainVisible = activeDomain === "all" || activeDomain === domain;
      let shownInDomain = 0;
      const cards = sectionEl.querySelectorAll<HTMLElement>(".pk-node-card");
      const total = cards.length;

      cards.forEach((card) => {
        const level = Number(card.dataset.level);
        const matchesSearch = !query || card.dataset.search!.includes(query);
        const matchesLevel = level <= maxLevel;
        const visible = domainVisible && matchesSearch && matchesLevel;
        card.style.display = visible ? "" : "none";
        if (visible) shownInDomain++;
      });

      sectionEl.style.display = domainVisible && shownInDomain === 0 && (query || maxLevel < 50) ? "none" : domainVisible ? "" : "none";
      const countEl = sectionEl.querySelector<HTMLElement>(`[data-domain-count="${domain}"]`)!;
      countEl.textContent = `${shownInDomain}/${total}`;
      shown += shownInDomain;
    }

    matchCount.textContent = String(shown);
    emptyEl.style.display = shown === 0 ? "" : "none";
  }

  search.addEventListener("input", applyFilters);

  chipsWrap.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".pk-chip");
    if (!btn) return;
    activeDomain = btn.dataset.domain!;
    chipsWrap.querySelectorAll(".pk-chip").forEach((c) => c.removeAttribute("data-active"));
    btn.setAttribute("data-active", "true");
    applyFilters();
  });

  slider.addEventListener("input", () => {
    maxLevel = Number(slider.value);
    const labels: Record<number, string> = { 10: "<1000", 20: "1000–1400", 30: "1400–1800", 40: "1800–2200", 50: "2200+" };
    levelValue.textContent = labels[maxLevel];
    applyFilters();
  });

  // Prereq pills jump to the referenced node -- reset filters first so the
  // target is guaranteed visible, same approach as openingExplorer's
  // depth-stepper reset.
  sectionsEl.addEventListener("click", (e) => {
    const practiceBtn = (e.target as HTMLElement).closest<HTMLButtonElement>(".pk-practice-btn[data-practice-code]");
    if (practiceBtn && onPractice) {
      const code = practiceBtn.dataset.practiceCode!;
      const themes = lichessThemesForPkCode(code);
      const node = PK_NODES.find((n) => n.code === code);
      if (themes && node) onPractice(code, themes, node.name);
      return;
    }

    const pill = (e.target as HTMLElement).closest<HTMLButtonElement>(".pk-pill[data-jump]");
    if (!pill) return;
    const targetId = "pk-node-" + pill.dataset.jump;

    search.value = "";
    activeDomain = "all";
    chipsWrap.querySelectorAll(".pk-chip").forEach((c) => c.removeAttribute("data-active"));
    chipsWrap.querySelector('.pk-chip[data-domain="all"]')!.setAttribute("data-active", "true");
    maxLevel = 50;
    slider.value = "50";
    levelValue.textContent = "2200+";
    applyFilters();

    requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("pk-flash");
      setTimeout(() => target.classList.remove("pk-flash"), 1100);
    });
  });

  applyFilters();
}
