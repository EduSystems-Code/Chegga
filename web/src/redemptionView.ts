// Chegga Web — render for the "Redeem a loss" checklist.
// Rows are compiled live from the same blunder/mistake moves the puzzle
// trainer uses (Puzzle[]), annotated with the opponent's real rating and
// redeemed-state. Actions are handled by main.ts via data-attributes.

import type { Puzzle } from "./puzzleTrainer";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface RedemptionRow {
  puzzle: Puzzle;
  opponentRating: number;
  redeemed: boolean;
}

export function renderRedemptionList(rows: RedemptionRow[], activeId: string | null): string {
  if (rows.length === 0) {
    return `<p class="status-line">No blunders to redeem yet — analyze some games first.</p>`;
  }

  const redeemedCount = rows.filter((r) => r.redeemed).length;

  const items = rows
    .map((r) => {
      const p = r.puzzle;
      const isActive = p.id === activeId;
      const tag = p.blunderTag ? p.blunderTag.replace(/_/g, " ") : p.classification;
      const action = r.redeemed
        ? `<span class="today-check">✓ redeemed</span>`
        : `<button type="button" class="redeem-btn" data-redeem-id="${esc(p.id)}">${isActive ? "Loaded ↓" : "Redeem"}</button>`;
      return `
        <li class="redeem-row${r.redeemed ? " today-item-done" : ""}${isActive ? " redeem-row-active" : ""}">
          <div class="redeem-row-main">
            <span class="redeem-row-title">${esc(p.gamePhase)} · you played <strong>${esc(p.playedSan)}</strong>, best was <strong>${esc(p.bestMoveSan)}</strong></span>
            <span class="status-line">−${p.centipawnLoss}cp · ${esc(tag)} · vs ~${r.opponentRating}</span>
          </div>
          ${action}
        </li>`;
    })
    .join("");

  return `
    <p class="status-line">${redeemedCount}/${rows.length} redeemed — replay from the mistake, first move must match the engine, then play it out against the bot at the opponent's strength.</p>
    <ul class="redeem-list">${items}</ul>
  `;
}
