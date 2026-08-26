// Chegga Web — rendering for skillProfile.ts's growth-path assessment

import type { SkillAssessment, SkillCategoryId } from "./skillProfile";
import { SKILL_CATEGORY_LABELS } from "./skillProfile";
import type { SkillSnapshotRecord } from "./db";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#e3a857";
  if (score >= 40) return "#f2a13f";
  return "#f2555a";
}

const CHART_W = 520;
const CHART_H = 120;
const CHART_PAD = 24;

function renderTrendChart(snapshots: SkillSnapshotRecord[], category: SkillCategoryId): string {
  const points = snapshots.filter((s) => s.scores[category] !== undefined).map((s) => ({ x: s.timestamp, y: s.scores[category], date: s.dateStamp }));
  if (points.length < 2) {
    return `<p class="status-line">Check back after a few more sync/analyze sessions to see a real trend line here — need at least 2 data points, have ${points.length}.</p>`;
  }

  const minT = points[0].x;
  const maxT = points[points.length - 1].x;
  const tRange = Math.max(1, maxT - minT);

  const x = (t: number) => CHART_PAD + ((t - minT) / tRange) * (CHART_W - CHART_PAD * 2);
  const y = (score: number) => CHART_H - CHART_PAD - (score / 100) * (CHART_H - CHART_PAD * 2);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.x).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const delta = Math.round((last.y - first.y) * 10) / 10;
  const deltaColor = delta > 0 ? "#4ade80" : delta < 0 ? "#f2555a" : "#8a93a6";

  return `
    <div class="rating-chart-block">
      <h4>${esc(SKILL_CATEGORY_LABELS[category])} over time <span class="status-line">(${first.date} &rarr; ${last.date}, <span style="color:${deltaColor}">${delta >= 0 ? "+" : ""}${delta}</span>)</span></h4>
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" style="max-width:${CHART_W}px" role="img" aria-label="${esc(SKILL_CATEGORY_LABELS[category])} score over time">
        <line x1="${CHART_PAD}" y1="${CHART_H - CHART_PAD}" x2="${CHART_W - CHART_PAD}" y2="${CHART_H - CHART_PAD}" stroke="#232833" stroke-width="1"/>
        <path d="${pathD}" fill="none" stroke="#e3a857" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${x(last.x).toFixed(1)}" cy="${y(last.y).toFixed(1)}" r="4" fill="#e3a857"/>
        <text x="${CHART_PAD}" y="14" font-size="11" fill="#8a93a6" font-family="monospace">0-100</text>
        <text x="${x(first.x).toFixed(1)}" y="${CHART_H - 8}" font-size="10" fill="#5c6478" font-family="monospace" text-anchor="start">${Math.round(first.y)}</text>
        <text x="${x(last.x).toFixed(1)}" y="${CHART_H - 8}" font-size="10" fill="#5c6478" font-family="monospace" text-anchor="end">${Math.round(last.y)}</text>
      </svg>
    </div>
  `;
}

export function renderSkillProfile(assessment: SkillAssessment, snapshots: SkillSnapshotRecord[]): string {
  const bars = assessment.scores
    .map((s) => {
      if (s.score === undefined) {
        return `
          <div class="skill-bar-row">
            <div class="skill-bar-label">${esc(SKILL_CATEGORY_LABELS[s.category])}</div>
            <div class="skill-bar-track"><div class="skill-bar-empty">not enough data yet (${s.moveCount}/20 moves)</div></div>
          </div>`;
      }
      const isWeakest = assessment.weakest?.category === s.category;
      return `
        <div class="skill-bar-row${isWeakest ? " skill-bar-weakest" : ""}">
          <div class="skill-bar-label">${esc(SKILL_CATEGORY_LABELS[s.category])}${isWeakest ? " — focus" : ""}</div>
          <div class="skill-bar-track">
            <div class="skill-bar-fill" style="width:${s.score}%;background:${scoreColor(s.score)}"></div>
            <span class="skill-bar-value">${Math.round(s.score)}/100</span>
          </div>
        </div>`;
    })
    .join("");

  if (!assessment.weakest) {
    return `
      <div class="skill-bars">${bars}</div>
      <p class="status-line" style="margin-top:12px">${esc(assessment.rootCause)}</p>
    `;
  }

  const prescriptionButton = assessment.prescription
    ? `<button type="button" id="skill-prescription-btn" data-action="${esc(JSON.stringify(assessment.prescription.action))}">Go practice this &darr;</button>`
    : "";

  return `
    <div class="skill-bars">${bars}</div>
    <div class="skill-focus-card">
      <h3 style="margin-top:0">Current focus: ${esc(SKILL_CATEGORY_LABELS[assessment.weakest.category])}</h3>
      <p>${esc(assessment.rootCause)}</p>
      ${assessment.prescription ? `<p><strong>Prescribed:</strong> ${esc(assessment.prescription.text)}</p>` : ""}
      ${prescriptionButton}
    </div>
    ${renderTrendChart(snapshots, assessment.weakest.category)}
  `;
}
