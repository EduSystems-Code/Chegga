// Chegga Web — rendering for roadTo2000.ts

import type { RoadToTarget, RoadAction } from "./roadTo2000";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const ROAD_TARGET_OPTIONS = [1600, 1800, 2000, 2200, 2400] as const;

function barColor(share: number): string {
  if (share >= 0.4) return "#f2555a";
  if (share >= 0.2) return "#f2a13f";
  return "#e3a857";
}

export function renderRoadToTarget(road: RoadToTarget): string {
  const options = ROAD_TARGET_OPTIONS.map(
    (r) => `<option value="${r}"${r === road.target ? " selected" : ""}>${r}</option>`,
  ).join("");

  const header = `
    <div class="road-header">
      <p class="road-estimate">Model estimate now: <strong>${road.currentEstimate}</strong></p>
      <label class="road-target-label">Target
        <select id="road-target-select">${options}</select>
      </label>
      <p class="road-gap">${road.gap > 0 ? `Gap: <strong>${road.gap}</strong> points` : `You're already at or above this in the model.`}</p>
    </div>`;

  if (road.gap <= 0 || road.factors.length === 0) {
    return `
      ${header}
      <p class="status-line" style="margin-top:12px">
        ${road.gap <= 0
          ? "Pick a higher target to see what the model says would take you there."
          : "The model doesn't see an obvious quality gap between your current play and this target — the remaining difference is likely in things it doesn't measure (calculation depth, opening prep, time use, consistency). The cards below still apply."}
      </p>`;
  }

  const maxGain = Math.max(...road.factors.map((f) => f.pointsGain));
  const rows = road.factors
    .map((f) => {
      const width = Math.max(6, Math.round((f.pointsGain / maxGain) * 100));
      const share = road.explainedPoints ? f.pointsGain / road.explainedPoints : 0;
      const unit = f.area === "blunder_rate" || f.area === "best_rate" ? "%" : " cp";
      return `
        <div class="road-factor">
          <div class="road-factor-top">
            <span class="road-factor-label">${esc(f.label)}</span>
            <span class="road-factor-gain">+${f.pointsGain} pts</span>
          </div>
          <div class="road-factor-track"><div class="road-factor-fill" style="width:${width}%;background:${barColor(share)}"></div></div>
          <p class="road-factor-detail">
            ${f.currentValue}${unit} now → ${f.targetValue}${unit} target. ${esc(f.practice)}
            <button type="button" class="road-jump-btn" data-action="${esc(JSON.stringify(f.action))}">Practice this ↓</button>
          </p>
        </div>`;
    })
    .join("");

  return `
    ${header}
    <div class="road-factors">${rows}</div>
    <p class="status-line" style="margin-top:14px">
      These factors account for roughly <strong>+${road.explainedPoints}</strong> of your ${road.gap}-point gap in a
      simple linear model (it explains ~14% of rating variance overall — treat the numbers as a rough ranking of where
      to spend effort, not a promise). The rest is calculation, preparation, and consistency the model can't see.
    </p>`;
}

export type { RoadAction };
