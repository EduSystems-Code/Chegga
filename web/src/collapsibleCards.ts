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

/** Collapsed by default until the viewer explicitly opens (and thereby
 * saves a preference for) a card -- distinct from "never set," which is
 * why this isn't just `=== "1"` defaulting false. */
function loadCollapsed(id: string): boolean {
  try {
    const stored = localStorage.getItem(STATE_KEY_PREFIX + id);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function saveCollapsed(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(STATE_KEY_PREFIX + id, collapsed ? "1" : "0");
  } catch {
    // ignore -- best-effort only
  }
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
