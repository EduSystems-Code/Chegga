// Chegga Web — game review: the HTML around the board
//
// Two pieces of markup, both driven entirely by gameReview.ts's model and
// the shared move-quality palette (classificationColors.ts), so a color
// means the same thing here, on the board, and on the profile bar:
//   - the timeline strip: one clickable chip per half-move, the
//     reviewer's own moves colored by tier, the opponent's kept small and
//     neutral so the reviewer's own shape is what reads at a glance.
//   - the tally: how many of their moves landed in each tier.

import { getClassColor } from "./classificationColors";
import { moveLabel, tallyHumanQuality, REVIEW_QUALITY_LABELS, type ReviewGame } from "./gameReview";

function escapeAttr(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/** `currentIndex` is -1 for the starting position (no chip current). */
export function renderReviewStrip(review: ReviewGame, currentIndex: number): string {
  const chips = review.steps
    .map((step, i) => {
      const tier = step.classification;
      const label = tier ? (REVIEW_QUALITY_LABELS[tier] ?? tier) : "not graded";
      const aria = `${moveLabel(step)} — ${step.isHuman ? label : "opponent"}`;
      const classes = [
        "review-chip",
        step.isHuman ? "review-chip-mine" : "review-chip-theirs",
        i === currentIndex ? "review-chip-current" : "",
      ]
        .filter(Boolean)
        .join(" ");
      // An ungraded or opponent move gets a neutral chip. --muted-dim, not
      // a border color: a 9px block in a border color disappears against
      // the dark page, and the opponent's moves are still the beat of the
      // game even when they aren't what the review is grading.
      const color = step.isHuman && tier ? getClassColor(tier) : "var(--muted-dim)";
      return `<button type="button" class="${classes}" data-review-index="${i}" style="--chip-color:${color}" title="${escapeAttr(aria)}" aria-label="${escapeAttr(aria)}"></button>`;
    })
    .join("");
  return `<div class="review-strip" id="review-strip">${chips}</div>`;
}

// The board labels ("Best!", "Inaccuracy") don't read as counts, so the
// tally has its own nouns: singular, pluralized where the word needs it.
const TALLY_NOUN: Record<string, [singular: string, plural: string]> = {
  best: ["best", "best"],
  excellent: ["excellent", "excellent"],
  good: ["good", "good"],
  inaccuracy: ["inaccuracy", "inaccuracies"],
  mistake: ["mistake", "mistakes"],
  blunder: ["blunder", "blunders"],
};

export function renderQualityTally(review: ReviewGame): string {
  const tally = tallyHumanQuality(review);
  if (!tally.length) return "";
  const items = tally
    .map(({ classification, count }) => {
      const noun = TALLY_NOUN[classification] ?? [classification, classification];
      return `<span class="quality-tally-item"><span class="quality-dot" style="background:${getClassColor(classification)}"></span>${count} ${count === 1 ? noun[0] : noun[1]}</span>`;
    })
    .join("");
  return `<div class="quality-tally">${items}</div>`;
}
