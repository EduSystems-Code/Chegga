// Chegga Web — rendering for rivalTracking.ts

import type { RivalRecord, RivalInsight } from "./rivalTracking";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const TONE_CLASS: Record<RivalInsight["tone"], string> = {
  strong: "status-ok",
  weak: "status-error",
  even: "status-line",
  neutral: "status-line",
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function renderRivalTracking(records: RivalRecord[], insights: RivalInsight[]): string {
  if (records.length === 0) {
    return `<p class="status-line">No repeat opponents yet — this fills in once you've played the same person 2+ times.</p>`;
  }

  const rows = records
    .map((r) => {
      return `
        <tr>
          <td>${esc(r.opponent)}</td>
          <td>${r.games}</td>
          <td>${r.wins}-${r.losses}-${r.draws}</td>
          <td>${Math.round(r.winRate * 100)}%</td>
          <td>${r.recentAvgOpponentRating ?? "—"}</td>
          <td>${r.allTimeAvgOpponentRating ?? "—"}</td>
          <td>${formatDate(r.lastPlayed)}</td>
        </tr>
      `;
    })
    .join("");

  const insightCards = insights
    .slice(0, 6) // headline read on your top rivals only -- the full table below covers the rest
    .map((i) => `<p class="${TONE_CLASS[i.tone]}"><strong>${esc(i.opponent)}</strong> — ${esc(i.text)}</p>`)
    .join("");

  return `
    <div class="rival-insights">${insightCards}</div>
    <table>
      <thead><tr><th>Opponent</th><th>Games</th><th>W-L-D</th><th>Win rate</th><th>Avg rating (recent)</th><th>Avg rating (all-time)</th><th>Last played</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
