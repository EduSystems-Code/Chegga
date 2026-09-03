// Chegga Web — rendering for rivalTracking.ts

import type { RivalRecord, RivalInsight, RivalDelta } from "./rivalTracking";

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

/** One plain-language line: what moved in your head-to-heads since the
 * last visit that had a snapshot. Empty string when there's nothing new
 * (no prior snapshot, or no games against a known rival since). */
function renderSinceLine(deltas: RivalDelta[], sinceLabel: string): string {
  if (deltas.length === 0 || !sinceLabel) return "";
  const parts = deltas.slice(0, 3).map((d) => {
    const rec = `${d.winsDelta >= 0 ? "+" : ""}${d.winsDelta}/${d.lossesDelta >= 0 ? "+" : ""}${d.lossesDelta}/${d.drawsDelta >= 0 ? "+" : ""}${d.drawsDelta}`;
    const swing =
      d.winRateDelta > 0.001 ? ` <span class="status-ok">▲${Math.round(d.winRateDelta * 100)}%</span>`
      : d.winRateDelta < -0.001 ? ` <span class="status-error">▼${Math.round(Math.abs(d.winRateDelta) * 100)}%</span>`
      : "";
    return `${esc(d.opponent)} (${d.newGames} game${d.newGames === 1 ? "" : "s"}, W/L/D ${rec})${swing}`;
  });
  const more = deltas.length > 3 ? ` +${deltas.length - 3} more` : "";
  return `<p class="rival-since"><strong>Since ${esc(sinceLabel)}:</strong> ${parts.join("; ")}${more}.</p>`;
}

export function renderRivalTracking(
  records: RivalRecord[],
  insights: RivalInsight[],
  deltas: RivalDelta[] = [],
  sinceLabel = "",
): string {
  if (records.length === 0) {
    return `<p class="status-line">No repeat opponents yet — this fills in once you've played the same person 2+ times.</p>`;
  }

  const sinceLine = renderSinceLine(deltas, sinceLabel);

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
    ${sinceLine}
    <div class="rival-insights">${insightCards}</div>
    <table>
      <thead><tr><th>Opponent</th><th>Games</th><th>W-L-D</th><th>Win rate</th><th>Avg rating (recent)</th><th>Avg rating (all-time)</th><th>Last played</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
