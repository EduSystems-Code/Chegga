// Chegga Web — rendering for gamePatterns.ts's insights
//
// The rating trajectory is the one real "chart" here — a single-series
// line, so per the dataviz skill's own rule ("a single series needs no
// legend box — the title names it") there's no legend, just the series
// itself: 2px line, round caps, a filled end-dot, direct value labels at
// the first/last point rather than a dense axis.

import type {
  EndingBreakdown,
  RatingTrajectory,
  OpponentStrengthBucket,
  GameLengthPatterns,
  TimeOfDayBucket,
  CastlingBreakdown,
} from "./gamePatterns";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ENDING_LABELS: Record<string, string> = {
  checkmate: "Checkmate",
  resignation: "Resignation",
  timeout: "Timeout",
  abandonment: "Abandonment",
  draw: "Draw",
  other: "Other",
};

function renderEndingBreakdown(endings: EndingBreakdown[]): string {
  const rows = endings
    .map((e) => `<tr><td>${ENDING_LABELS[e.category] ?? e.category}</td><td>${e.count}</td><td>${Math.round(e.share * 100)}%</td></tr>`)
    .join("");
  return `
    <h3>How your games actually end</h3>
    <table><thead><tr><th>Ending</th><th>Games</th><th>%</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

const CHART_W = 560;
const CHART_H = 140;
const CHART_PAD = 28;

function renderRatingChart(trajectory: RatingTrajectory): string {
  const { points, timeClass } = trajectory;
  const ratings = points.map((p) => p.rating);
  const minR = Math.min(...ratings);
  const maxR = Math.max(...ratings);
  const range = Math.max(1, maxR - minR);

  const x = (i: number) => CHART_PAD + (i / (points.length - 1)) * (CHART_W - CHART_PAD * 2);
  const y = (r: number) => CHART_H - CHART_PAD - ((r - minR) / range) * (CHART_H - CHART_PAD * 2);

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.rating).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.rating - first.rating;
  const deltaColor = delta > 0 ? "#4ade80" : delta < 0 ? "#f2555a" : "#8a93a6";

  return `
    <div class="rating-chart-block">
      <h4>${esc(timeClass)} <span class="status-line">(${points.length} rated games, ${first.rating} &rarr; ${last.rating}, <span style="color:${deltaColor}">${delta >= 0 ? "+" : ""}${delta}</span>)</span></h4>
      <svg viewBox="0 0 ${CHART_W} ${CHART_H}" width="100%" style="max-width:${CHART_W}px" role="img" aria-label="${esc(timeClass)} rating over time">
        <line x1="${CHART_PAD}" y1="${CHART_H - CHART_PAD}" x2="${CHART_W - CHART_PAD}" y2="${CHART_H - CHART_PAD}" stroke="#232833" stroke-width="1"/>
        <path d="${pathD}" fill="none" stroke="#e3a857" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.rating).toFixed(1)}" r="4" fill="#e3a857"/>
        <text x="${CHART_PAD}" y="14" font-size="11" fill="#8a93a6" font-family="monospace">${minR}-${maxR}</text>
        <text x="${x(0).toFixed(1)}" y="${CHART_H - 8}" font-size="10" fill="#5c6478" font-family="monospace" text-anchor="start">${first.rating}</text>
        <text x="${x(points.length - 1).toFixed(1)}" y="${CHART_H - 8}" font-size="10" fill="#5c6478" font-family="monospace" text-anchor="end">${last.rating}</text>
      </svg>
    </div>
  `;
}

function renderOpponentStrength(buckets: OpponentStrengthBucket[]): string {
  const rows = buckets
    .map((b) => `<tr><td>${esc(b.label)}</td><td>${b.games}</td><td>${b.wins}W ${b.losses}L ${b.draws}D</td><td>${Math.round(b.winRate * 100)}%</td></tr>`)
    .join("");
  return `
    <h3>Performance vs. opponent strength</h3>
    <table><thead><tr><th>Band</th><th>Games</th><th>Record</th><th>Win rate</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

function renderGameLength(lengths: GameLengthPatterns): string {
  const parts: string[] = [];
  if (lengths.avgLengthWin !== undefined) parts.push(`<div class="stat-card"><div class="stat-value">${lengths.avgLengthWin}</div><div class="stat-label">avg moves in wins</div></div>`);
  if (lengths.avgLengthLoss !== undefined) parts.push(`<div class="stat-card"><div class="stat-value">${lengths.avgLengthLoss}</div><div class="stat-label">avg moves in losses</div></div>`);
  if (lengths.avgLengthDraw !== undefined) parts.push(`<div class="stat-card"><div class="stat-value">${lengths.avgLengthDraw}</div><div class="stat-label">avg moves in draws</div></div>`);
  if (parts.length === 0) return "";
  return `<h3>Game length</h3><div class="stat-grid">${parts.join("")}</div>`;
}

function renderTimeOfDay(buckets: TimeOfDayBucket[]): string {
  if (buckets.length === 0) return "";
  const rows = buckets
    .map((b) => `<tr><td>${esc(b.label)}</td><td>${b.games}</td><td>${Math.round(b.winRate * 100)}%</td></tr>`)
    .join("");
  return `
    <h3>Time-of-day patterns <span class="status-line">(your local time)</span></h3>
    <table><thead><tr><th>When</th><th>Games</th><th>Win rate</th></tr></thead><tbody>${rows}</tbody></table>
  `;
}

function renderCastling(castling: CastlingBreakdown): string {
  const total = castling.kingside + castling.queenside + castling.never;
  if (total === 0) return "";
  return `
    <h3>Castling side</h3>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${castling.kingside}</div><div class="stat-label">kingside (${Math.round((castling.kingside / total) * 100)}%)</div></div>
      <div class="stat-card"><div class="stat-value">${castling.queenside}</div><div class="stat-label">queenside (${Math.round((castling.queenside / total) * 100)}%)</div></div>
      <div class="stat-card"><div class="stat-value">${castling.never}</div><div class="stat-label">never castled (${Math.round((castling.never / total) * 100)}%)</div></div>
    </div>
  `;
}

export function renderGamePatterns(
  endings: EndingBreakdown[],
  trajectories: RatingTrajectory[],
  opponentStrength: OpponentStrengthBucket[],
  gameLength: GameLengthPatterns,
  timeOfDay: TimeOfDayBucket[],
  castling: CastlingBreakdown,
  firstMistakePly: number | undefined,
): string {
  const sections: string[] = [];

  if (endings.length > 0) sections.push(renderEndingBreakdown(endings));

  if (trajectories.length > 0) {
    sections.push(`<h3>Rating over time</h3>${trajectories.map(renderRatingChart).join("")}`);
  }

  if (opponentStrength.length > 0) sections.push(renderOpponentStrength(opponentStrength));

  const lengthHtml = renderGameLength(gameLength);
  if (lengthHtml) sections.push(lengthHtml);

  const todHtml = renderTimeOfDay(timeOfDay);
  if (todHtml) sections.push(todHtml);

  const castlingHtml = renderCastling(castling);
  if (castlingHtml) sections.push(castlingHtml);

  if (firstMistakePly !== undefined) {
    sections.push(
      `<div class="insight-item">On average, your first real mistake lands around ply ${firstMistakePly} (move ${Math.ceil(firstMistakePly / 2)}).</div>`,
    );
  }

  return sections.join("");
}
