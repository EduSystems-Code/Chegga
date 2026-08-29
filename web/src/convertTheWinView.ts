// Chegga Web — rendering for convertTheWin.ts

import type { ThrownGame } from "./convertTheWin";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function when(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function renderThrownGames(games: ThrownGame[]): string {
  if (games.length === 0) {
    return `<p class="status-line">No analyzed games where you reached a clearly winning position and didn't win it. Analyze more games to populate this.</p>`;
  }

  const losses = games.filter((g) => g.result === "loss").length;
  const rows = games
    .map((g) => {
      const slip = g.slipSan
        ? `move ${g.slipMoveNumber}, <strong>${esc(g.slipSan)}</strong> (−${g.slipCpLoss}cp)`
        : "—";
      return `
        <tr>
          <td>${when(g.endTime)}</td>
          <td>${esc(g.timeClass)}</td>
          <td>~${g.opponentRating}</td>
          <td class="ctw-peak">+${g.peakEvalPawns}</td>
          <td class="ctw-result ctw-${g.result}">${g.result}</td>
          <td>${slip}</td>
          <td><a href="${esc(g.url)}" target="_blank" rel="noopener">open ↗</a></td>
        </tr>`;
    })
    .join("");

  return `
    <p class="tagline" style="margin-bottom:14px">
      ${games.length} game${games.length === 1 ? "" : "s"} where you stood clearly winning and it slipped
      (${losses} became losses). Peak = the best evaluation you reached, in pawns, from your side. Replay each from the
      slip move — on Chess.com via the link, or use <strong>Redeem a loss</strong> above for the engine-checked version.
    </p>
    <div class="ctw-table-wrap">
      <table class="ctw-table">
        <thead><tr><th>Date</th><th>Type</th><th>Opp.</th><th>Peak</th><th>Result</th><th>Slipped at</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
