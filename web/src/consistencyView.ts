// Chegga Web — rendering for consistencyMetrics.ts

import type { ConsistencySummary, SlotStat } from "./consistencyMetrics";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function slotRow(s: SlotStat, baseline: number): string {
  if (s.games === 0) return "";
  const delta = s.winRate - baseline;
  const color = delta >= 0.03 ? "#4ade80" : delta <= -0.03 ? "#f2555a" : "#9aa4b6";
  const width = Math.max(4, Math.round(s.winRate * 100));
  // vs-baseline direction as a word + glyph, so the bar colour is never
  // the only thing carrying "better/worse than usual".
  const vsBaseline =
    delta >= 0.03 ? "▲ above your baseline" : delta <= -0.03 ? "▼ below your baseline" : "≈ at your baseline";
  const label = `${s.label}: ${pct(s.winRate)} win rate over ${s.games} games, ${vsBaseline}`;
  return `
    <div class="consist-row">
      <div class="consist-label">${esc(s.label)} <span class="status-line">(${s.games} games${s.blundersPer100 !== undefined ? `, ${s.blundersPer100} blunders/100` : ""}) · ${vsBaseline}</span></div>
      <div class="consist-track" role="img" aria-label="${esc(label)}"><div class="consist-fill" style="width:${width}%;background:${color}"></div><span class="consist-val">${pct(s.winRate)}</span></div>
    </div>`;
}

export function renderConsistency(c: ConsistencySummary): string {
  const rows = [
    slotRow(c.afterLoss, c.baselineWinRate),
    slotRow(c.afterWin, c.baselineWinRate),
    ...c.bySessionDepth.map((s) => slotRow(s, c.baselineWinRate)),
  ].join("");

  const recs = c.recommendations.map((r) => `<li>${esc(r)}</li>`).join("");

  return `
    <p class="tagline" style="margin-bottom:14px">
      Baseline win rate: <strong>${pct(c.baselineWinRate)}</strong>. Bars above/below that line show where your
      results actually hold up or fall apart.
    </p>
    <div class="consist-rows">${rows}</div>
    <div class="consist-recs">
      <h4 style="margin:16px 0 8px">What to change</h4>
      <ul>${recs}</ul>
    </div>`;
}
