// Chegga Web — makes every `section.card` collapsible
//
// Generic and content-agnostic: wraps everything after a card's <h2> in a
// body element and toggles it on click, so this works the same whether
// the card's content was there at page-load or gets replaced later by
// `.innerHTML =` from a render function (profile, patterns, puzzle
// trainer, etc. all just keep writing into the same wrapped body div —
// they don't need to know collapsing exists). `<details>` elements (the
// cheat sheet, dev tools) already have native collapse and are left
// alone.
//
// Per-card open/closed state persists in localStorage so a reload
// doesn't re-expand everything you'd already tidied away — same
// per-viewer-convenience tier as the remembered username.

const STATE_KEY_PREFIX = "chegga-web:card-collapsed:";

// Every card defaults collapsed on first load -- except these. "Your
// focus" (the growth-path assessment) is meant to be the entry point of
// the whole page per its own design intent, not one tool among many;
// defaulting it collapsed like everything else buries the one thing a
// returning visitor should see first (caught live: the "Go practice this"
// button rendered correctly but was literally unclickable, hidden inside
// a collapsed card, on the very first verification pass). Same problem
// hit "Connect your Chess.com username" -- the actual entry point for a
// brand-new visitor, who has no focus data yet -- caught live the same
// way: the sync form was in the DOM but invisible/unclickable behind its
// own collapsed card on first load.
const DEFAULT_EXPANDED_IDS = new Set(["focus-section", "sync-section"]);

/** Collapsed by default until the viewer explicitly opens (and thereby
 * saves a preference for) a card -- distinct from "never set," which is
 * why this isn't just `=== "1"` defaulting false. */
function loadCollapsed(id: string): boolean {
  try {
    const stored = localStorage.getItem(STATE_KEY_PREFIX + id);
    if (stored !== null) return stored === "1";
    return !DEFAULT_EXPANDED_IDS.has(id);
  } catch {
    return !DEFAULT_EXPANDED_IDS.has(id);
  }
}

function saveCollapsed(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(STATE_KEY_PREFIX + id, collapsed ? "1" : "0");
  } catch {
    // ignore -- best-effort only
  }
}

/** Forces a specific card open and persists that as its saved state --
 * for the "Go practice this" focus prescription, which needs to actually
 * reveal the puzzle/vision/drill card it's pointing at, not just scroll to
 * a collapsed shell. No-op if the card isn't wrapped yet or has no id
 * match. */
export function expandCard(cardId: string): void {
  const card = document.getElementById(cardId);
  if (!card) return;
  const body = card.querySelector<HTMLElement>(".card-body");
  const chevron = card.querySelector<HTMLElement>(".card-chevron");
  if (!body) return;
  body.style.display = "";
  if (chevron) chevron.textContent = "▾";
  saveCollapsed(cardId, false);
}

/** Idempotent: safe to call again after new `section.card` elements are
 * added to the DOM (nothing double-wraps an already-wrapped card). */
export function setupCollapsibleCards(): void {
  const cards = document.querySelectorAll<HTMLElement>("section.card");

  cards.forEach((card, index) => {
    if (card.dataset.collapsibleReady) return;
    card.dataset.collapsibleReady = "1";

    const heading = card.querySelector("h2");
    if (!heading) return;

    // Stable-ish id: the card's own id if it has one, else a positional
    // fallback -- good enough for a per-viewer UI preference, not a key
    // that needs to survive a full page restructure.
    const cardId = card.id || `card-${index}`;

    const body = document.createElement("div");
    body.className = "card-body";
    // Move every sibling after the heading into the body wrapper.
    while (heading.nextSibling) {
      body.appendChild(heading.nextSibling);
    }
    card.appendChild(body);

    const chevron = document.createElement("span");
    chevron.className = "card-chevron";
    chevron.textContent = "▾";
    heading.appendChild(chevron);
    heading.classList.add("card-heading-collapsible");

    function applyState(collapsed: boolean) {
      body.style.display = collapsed ? "none" : "";
      chevron.textContent = collapsed ? "▸" : "▾";
    }

    applyState(loadCollapsed(cardId));

    heading.addEventListener("click", () => {
      const collapsed = body.style.display !== "none";
      applyState(collapsed);
      saveCollapsed(cardId, collapsed);
    });
  });
}
