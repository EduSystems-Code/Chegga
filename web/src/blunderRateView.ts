// Chegga Web — rendering for blunderRate.ts

import type { BlunderRateSummary } from "./blunderRate";
import { isColorblindPalette } from "./classificationColors";

const CHART_W = 520;
const CHART_H = 140;
const PAD = 28;

// The three series. Solid vs dashed already tells them apart without
// colour, but the palette still follows the viewer's colour-blind setting
// (the default red/green blunder-vs-target pair is the exact axis
// deuteranopia/protanopia collapse — same reason classificationColors.ts
// has a second palette).
function seriesColors(): { blunder: string; oversight: string; target: string; axisText: string } {
  return isColorblindPalette()
    ? { blunder: "#b23a00", oversight: "#e8842c", target: "#1565c0", axisText: "#5c6478" }
    : { blunder: "#f2555a", oversight: "#f2a13f", target: "#4ade80", axisText: "#5c6478" };
}

/** A one-line spoken summary of the chart for screen readers — the actual
 * numbers and direction, not just "a chart". */
function chartAltText(summary: BlunderRateSummary): string {
  const pts = summary.monthly;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dir =
    summary.trend === undefined || summary.trend === 0
      ? "roughly flat"
      : summary.trend < 0
        ? `down ${Math.abs(summary.trend)}`
        : `up ${summary.trend}`;
  return `Blunders per 100 moves by month: ${first.blundersPer100} in ${first.month}, ${last.blundersPer100} in ${last.month} (${dir}), against an expert reference line of ${summary.targetPer100}.`;
}

function lineChart(summary: BlunderRateSummary): string {
  const pts = summary.monthly;
  if (pts.length < 2) {
    return `<p class="status-line">Analyze games from at least two different months to see a trend line here.</p>`;
  }
  const c = seriesColors();
  const maxY = Math.max(summary.targetPer100 * 1.5, ...pts.map((p) => p.blundersPer100)) * 1.1;
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (CHART_W - PAD * 2);
  const y = (v: number) => CHART_H - PAD - (v / maxY) * (CHART_H - PAD * 2);

  const blunderPath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.blundersPer100).toFixed(1)}`).join(" ");
  const oversightPath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.oversightsPer100).toFixed(1)}`).join(" ");
  const targetY = y(summary.targetPer100).toFixed(1);

  const labels = pts
    .map((p, i) => (i === 0 || i === pts.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${CHART_H - 8}" font-size="10" fill="${c.axisText}" font-family="monospace" text-anchor="${i === 0 ? "start" : "end"}">${p.month}</text>` : ""))
    .join("");

  return `
    <svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" style="max-width:${CHART_W}px" role="img" aria-label="${chartAltText(summary)}">
      <line x1="${PAD}" y1="${CHART_H - PAD}" x2="${CHART_W - PAD}" y2="${CHART_H - PAD}" stroke="#232833" stroke-width="1"/>
      <line x1="${PAD}" y1="${targetY}" x2="${CHART_W - PAD}" y2="${targetY}" stroke="${c.target}" stroke-width="1" stroke-dasharray="4 3"/>
      <text x="${CHART_W - PAD}" y="${Number(targetY) - 4}" font-size="10" fill="${c.target}" font-family="monospace" text-anchor="end">target ${summary.targetPer100}</text>
      <path d="${oversightPath}" fill="none" stroke="${c.oversight}" stroke-width="1.5" stroke-dasharray="3 2" stroke-linecap="round"/>
      <path d="${blunderPath}" fill="none" stroke="${c.blunder}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${labels}
    </svg>
    <p class="status-line"><span style="color:${c.blunder}">━ all blunders</span> &nbsp; <span style="color:${c.oversight}">╌ one-move oversights</span> per 100 of your moves</p>`;
}

export function renderBlunderRate(summary: BlunderRateSummary): string {
  const c = seriesColors();
  const trendText =
    summary.trend === undefined
      ? ""
      : summary.trend < 0
        ? `<span style="color:${c.target}">down ${Math.abs(summary.trend)}</span> since your earliest analyzed month — keep going.`
        : summary.trend > 0
          ? `<span style="color:${c.blunder}">up ${summary.trend}</span> since your earliest analyzed month.`
          : `flat since your earliest analyzed month.`;

  return `
    <div class="blunder-rate-headline">
      <div class="brh-stat"><span class="brh-num">${summary.blundersPer100}</span><span class="brh-cap">blunders / 100 moves</span></div>
      <div class="brh-stat"><span class="brh-num">${summary.oversightsPer100}</span><span class="brh-cap">one-move oversights / 100</span></div>
      <div class="brh-stat"><span class="brh-num">${summary.targetPer100}</span><span class="brh-cap">≈ expert reference</span></div>
    </div>
    <p class="tagline" style="margin:10px 0 16px">
      This is the number to drive down first — one-move oversights are the biggest rating leak below 2000.
      ${trendText}
    </p>
    ${lineChart(summary)}
    <p class="card-action">
      <button type="button" class="blunder-practice-btn" data-action='{"kind":"puzzle"}'>Practice your own blunder positions ↓</button>
    </p>`;
}
