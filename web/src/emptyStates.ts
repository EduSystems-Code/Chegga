// Chegga Web — designed empty / pre-data states for the data-dependent cards.
//
// Redesign note #5: cards that are `display:none` until data land leave a
// new visitor looking at a stub page, and cards shown blank look broken.
// This gives every can-be-empty card the same shape while it waits:
//   - one line on what it will show
//   - a faded skeleton of the populated version (aria-hidden, decorative)
//   - the action that fills it
//
// It's pure string-building plus one delegated click handler. `emptyFor`
// is called from main.ts wherever the old code set a section to
// `display:none`; `showEmptyStates` seeds every card for a fresh visitor
// with no synced account at all.

type SkeletonKind = "report" | "bars" | "board" | "chart" | "rows" | "lines";

interface EmptyStateConfig {
  /** `<section>` id, still carrying the inline `display:none`. */
  sectionId: string;
  /** the `<div>` inside it whose innerHTML the real render replaces. */
  outputId: string;
  line: string;
  ctaLabel: string;
  skeleton: SkeletonKind;
}

// Order mirrors the DOM so the seeded page reads top-to-bottom sensibly.
const EMPTY_STATES: EmptyStateConfig[] = [
  {
    sectionId: "focus-section",
    outputId: "focus-output",
    line: "Once a few of your games are analyzed, this reads out the single area your play is weakest in right now — and one concrete thing to practice for it.",
    ctaLabel: "Sync your games",
    skeleton: "bars",
  },
  {
    sectionId: "profile-section",
    outputId: "profile-output",
    line: "Your move-quality trend, opening repertoire, blunder patterns, time-pressure correlation, and a strength estimate — built from your own analyzed games.",
    ctaLabel: "Sync your games",
    skeleton: "report",
  },
  {
    sectionId: "puzzle-section",
    outputId: "puzzle-output-empty",
    line: "Real positions from your own games, taken from the move right before a mistake. They appear here as soon as some games are analyzed.",
    ctaLabel: "Sync your games",
    skeleton: "board",
  },
  {
    sectionId: "redemption-section",
    outputId: "redemption-output",
    line: "Every blunder the engine finds in your games, worst first — replay each one and play it back out against the bot.",
    ctaLabel: "Sync your games",
    skeleton: "rows",
  },
  {
    sectionId: "insights-section",
    outputId: "insights-output",
    line: "Headline numbers pulled straight from your analyzed games: accuracy, your biggest recurring leak, weakest phase and opening.",
    ctaLabel: "Sync your games",
    skeleton: "lines",
  },
  {
    sectionId: "patterns-section",
    outputId: "patterns-output",
    line: "How your games end, your rating over time per time class, and your results against different opponent strengths — from every synced game, no analysis needed.",
    ctaLabel: "Sync your games",
    skeleton: "chart",
  },
  {
    sectionId: "rivals-section",
    outputId: "rivals-output",
    line: "Opponents you've faced more than once, with your real head-to-head record against each — not just a lifetime win rate.",
    ctaLabel: "Sync your games",
    skeleton: "rows",
  },
  {
    sectionId: "opening-section",
    outputId: "opening-output",
    line: "A board where every line is a move you've actually played — thicker and more solid the more often, colored by how well it tends to go.",
    ctaLabel: "Sync to build your opening map",
    skeleton: "board",
  },
  {
    sectionId: "depth-section",
    outputId: "depth-output",
    line: "Your games stacked by move number — your 1st move across every game, then your 2nd, and so on, stepped through one at a time.",
    ctaLabel: "Sync your games",
    skeleton: "board",
  },
  {
    sectionId: "vision-section",
    outputId: "vision-output-empty",
    line: "Quick yes/no drills from your own positions: is anything hanging? Available once you have analyzed games to draw from.",
    ctaLabel: "Sync your games",
    skeleton: "board",
  },
];

const byId = new Map(EMPTY_STATES.map((c) => [c.sectionId, c]));

function skeletonHtml(kind: SkeletonKind): string {
  switch (kind) {
    case "report":
      return `
        <div class="sk-line sk-lead"></div>
        <div class="sk-bars">${'<div class="sk-bar"></div>'.repeat(5)}</div>
        <div class="sk-line sk-w70"></div>
        <div class="sk-line sk-w45"></div>`;
    case "bars":
      return `<div class="sk-scorebars">${
        Array.from({ length: 4 }, (_, i) => `<div class="sk-scorebar"><span style="width:${[62, 44, 78, 33][i]}%"></span></div>`).join("")
      }</div>`;
    case "board":
      return `<div class="sk-board">${'<span></span>'.repeat(64)}</div>`;
    case "chart":
      return `<svg class="sk-chart" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="0,60 30,52 60,58 90,40 120,44 150,28 200,32" />
      </svg>`;
    case "rows":
      return `<div class="sk-rows">${'<div class="sk-row"></div>'.repeat(4)}</div>`;
    case "lines":
      return `<div class="sk-lines">${['sk-w90', 'sk-w70', 'sk-w80', 'sk-w55'].map((w) => `<div class="sk-line ${w}"></div>`).join('')}</div>`;
  }
}

function emptyStateHtml(cfg: EmptyStateConfig): string {
  return `<div class="empty-state">
    <div class="empty-state-skeleton" aria-hidden="true">${skeletonHtml(cfg.skeleton)}</div>
    <p class="empty-state-line">${cfg.line}</p>
    <button type="button" class="empty-state-cta" data-empty-cta>${cfg.ctaLabel}</button>
  </div>`;
}

/**
 * Show one data-dependent card in its waiting state instead of hiding it.
 * A no-op (returns false) for an unknown id, so callers can drop it in
 * next to the existing `section.style.display = "none"` lines safely.
 */
export function emptyFor(sectionId: string): boolean {
  const cfg = byId.get(sectionId);
  if (!cfg) return false;
  const section = document.getElementById(cfg.sectionId);
  let output = document.getElementById(cfg.outputId);
  // A couple of cards keep their board/controls markup directly in the
  // section with no single replaceable output div -- give those a
  // dedicated empty-state host so the real controls are never clobbered.
  if (!output && section) {
    output = document.createElement("div");
    output.id = cfg.outputId;
    section.appendChild(output);
  }
  if (!section || !output) return false;
  section.style.display = "";
  output.innerHTML = emptyStateHtml(cfg);
  output.dataset.emptyState = "1";
  return true;
}

/** Clear a card's empty state once real content is about to be rendered. */
export function clearEmptyFor(sectionId: string): void {
  const cfg = byId.get(sectionId);
  if (!cfg) return;
  const output = document.getElementById(cfg.outputId);
  if (output?.dataset.emptyState) {
    output.innerHTML = "";
    delete output.dataset.emptyState;
  }
}

/** Seed every data-dependent card for a visitor with no synced account. */
export function showEmptyStates(): void {
  for (const cfg of EMPTY_STATES) emptyFor(cfg.sectionId);
}

/** Wire the CTA buttons once: jump to the sync form and focus the input. */
export function wireEmptyStateCtas(): void {
  document.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-empty-cta]");
    if (!btn) return;
    document.getElementById("sync-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.getElementById("username")?.focus(), 400);
  });
}
