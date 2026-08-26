// Chegga Web — move-frequency "spider web" board
//
// Two encodings on one board, per the user's own explicit design call:
//   - color = move quality (best -> blunder), the same fixed categorical
//     palette already used in profileView.ts's move-quality bar
//     (classificationColors.ts) — reused, not invented, so a color means
//     the same thing everywhere in the app.
//   - opacity/thickness = how often you play it: a move you reach for
//     constantly is solid and thick; one you've played once is faint and
//     thin ("more opacity = more common", the user's own framing).
// A real chess set (Unicode glyphs at the standard starting position) sits
// underneath as a dim backdrop so the board reads as an actual chessboard,
// not an abstract grid. A table view ships alongside as the accessible
// fallback for the color/opacity encoding, listing every move -- not just
// the ones drawn on the board.

import type { MoveFrequency } from "./openingExplorer";
import { CLASSIFICATION_ORDER, getClassColor } from "./classificationColors";

const SQUARE = 60;
const MARGIN = 28;
const BOARD_PX = SQUARE * 8;
const VIEWBOX = BOARD_PX + MARGIN * 2;

const SQUARE_LIGHT = "#252c3a";
const SQUARE_DARK = "#161a22";
const SQUARE_BORDER = "#323a4a";

// Standard starting position, Unicode chess glyphs. Rendered dim/behind
// the data layer -- a recognizable board, not the focal point.
const START_POSITION: Record<string, string> = {
  a1: "♖", b1: "♘", c1: "♗", d1: "♕", e1: "♔", f1: "♗", g1: "♘", h1: "♖",
  a2: "♙", b2: "♙", c2: "♙", d2: "♙", e2: "♙", f2: "♙", g2: "♙", h2: "♙",
  a7: "♟", b7: "♟", c7: "♟", d7: "♟", e7: "♟", f7: "♟", g7: "♟", h7: "♟",
  a8: "♜", b8: "♞", c8: "♝", d8: "♛", e8: "♚", f8: "♝", g8: "♞", h8: "♜",
};
// Light enough to actually read against the dark squares (#161a22 /
// #252c3a) at low opacity -- an earlier version used near-black fills
// that were technically in the DOM but visually invisible.
const WHITE_PIECE_COLOR = "#c7cfdd";
const BLACK_PIECE_COLOR = "#8a93a6";

function squareCenter(square: string): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = parseInt(square[1], 10); // 1..8
  return {
    x: MARGIN + file * SQUARE + SQUARE / 2,
    y: MARGIN + (8 - rank) * SQUARE + SQUARE / 2,
  };
}

function boardSquares(): string {
  let out = "";
  for (let rank = 8; rank >= 1; rank--) {
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const file = String.fromCharCode(97 + fileIdx);
      const isLight = (fileIdx + rank) % 2 === 1;
      const x = MARGIN + fileIdx * SQUARE;
      const y = MARGIN + (8 - rank) * SQUARE;
      out += `<rect x="${x}" y="${y}" width="${SQUARE}" height="${SQUARE}" fill="${isLight ? SQUARE_LIGHT : SQUARE_DARK}" stroke="${SQUARE_BORDER}" stroke-width="1"/>`;
      if (rank === 1) {
        out += `<text x="${x + SQUARE - 6}" y="${y + SQUARE - 6}" font-size="9" fill="#5c6478" font-family="monospace" text-anchor="end">${file}</text>`;
      }
      if (fileIdx === 0) {
        out += `<text x="${x + 6}" y="${y + 12}" font-size="9" fill="#5c6478" font-family="monospace">${rank}</text>`;
      }
    }
  }
  return out;
}

function boardPieces(): string {
  let out = "";
  for (const [square, glyph] of Object.entries(START_POSITION)) {
    const { x, y } = squareCenter(square);
    const rank = parseInt(square[1], 10);
    const color = rank <= 2 ? WHITE_PIECE_COLOR : BLACK_PIECE_COLOR;
    out += `<text x="${x}" y="${y + 12}" font-size="38" text-anchor="middle" fill="${color}" opacity="0.55">${glyph}</text>`;
  }
  return out;
}

/** Escapes text for safe inclusion inside an SVG <title> tooltip. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderOpeningBoard(
  displayMoves: MoveFrequency[],
  allMoves: MoveFrequency[],
  totalGames: number,
  title: string,
): string {
  const maxCount = displayMoves.reduce((m, mv) => Math.max(m, mv.count), 0) || 1;

  // Opacity/width scale continuously with frequency (sqrt so a handful of
  // outlier-common moves don't crush everything else to invisible) --
  // "more opacity = more common," per the user's own framing.
  const opacityFor = (frac: number) => 0.22 + 0.7 * Math.sqrt(frac);
  const widthFor = (frac: number) => 2 + 7 * Math.sqrt(frac);

  const glows = displayMoves
    .map((mv) => {
      const frac = mv.count / maxCount;
      const { x, y } = squareCenter(mv.to);
      const r = 10 + 14 * frac;
      const color = getClassColor(mv.classification) ?? "#8a93a6";
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity="${(0.12 + 0.28 * frac).toFixed(2)}"/>`;
    })
    .join("");

  const arrows = displayMoves
    .map((mv) => {
      const frac = mv.count / maxCount;
      const from = squareCenter(mv.from);
      const to = squareCenter(mv.to);
      const width = widthFor(frac);
      const color = getClassColor(mv.classification) ?? "#8a93a6";
      const pct = totalGames ? ((mv.count / totalGames) * 100).toFixed(1) : "0.0";
      return (
        `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" ` +
        `stroke="${color}" stroke-width="${width.toFixed(1)}" stroke-linecap="round" ` +
        `opacity="${opacityFor(frac).toFixed(2)}">` +
        `<title>${esc(mv.san)} — ${mv.count}× (${pct}%), avg ${mv.avgCentipawnLoss.toFixed(0)}cp, ${esc(mv.classification)}</title>` +
        `</line>`
      );
    })
    .join("");

  const dots = displayMoves
    .map((mv) => {
      const frac = mv.count / maxCount;
      const to = squareCenter(mv.to);
      const color = getClassColor(mv.classification) ?? "#8a93a6";
      const pct = totalGames ? ((mv.count / totalGames) * 100).toFixed(1) : "0.0";
      return (
        `<circle cx="${to.x}" cy="${to.y}" r="5" fill="${color}" opacity="${opacityFor(frac).toFixed(2)}" stroke="#0a0c10" stroke-width="1.5">` +
        `<title>${esc(mv.san)} — ${mv.count}× (${pct}%), avg ${mv.avgCentipawnLoss.toFixed(0)}cp, ${esc(mv.classification)}</title>` +
        `</circle>`
      );
    })
    .join("");

  const qualityLegend = CLASSIFICATION_ORDER.map(
    (label) => `<span class="opening-legend-swatch" style="background:${getClassColor(label)}"></span>${esc(label)}`,
  ).join(" ");

  const rows = allMoves
    .map((mv) => {
      const pct = totalGames ? ((mv.count / totalGames) * 100).toFixed(1) : "0.0";
      return `<tr><td>${esc(mv.san)}</td><td>${esc(mv.from)}→${esc(mv.to)}</td><td>${mv.count}</td><td>${pct}%</td><td>${mv.avgCentipawnLoss.toFixed(0)} cp</td><td>${esc(mv.classification)}</td></tr>`;
    })
    .join("");

  const shownNote =
    displayMoves.length < allMoves.length
      ? `<p class="status-line">Showing the top moves per square (${displayMoves.length} of ${allMoves.length} distinct moves) — see the table for the full list.</p>`
      : "";

  const tableId = `opening-table-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return `
    <div class="opening-board-block">
      <div class="opening-board-header">
        <h3>${esc(title)} <span class="status-line">(${totalGames} games)</span></h3>
      </div>
      <div class="opening-legend-row">
        <div class="opening-legend">
          <span class="opening-legend-label">rare</span>
          <span class="opening-legend-ramp"></span>
          <span class="opening-legend-label">common</span>
        </div>
        <div class="opening-legend opening-legend-quality">${qualityLegend}</div>
      </div>
      ${shownNote}
      <svg viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="100%" style="max-width:${VIEWBOX}px" role="img" aria-label="${esc(title)} move frequency board">
        ${boardSquares()}
        ${boardPieces()}
        ${glows}
        ${arrows}
        ${dots}
      </svg>
      <details class="opening-table-toggle">
        <summary>View as table (all ${allMoves.length} moves, accessible alternative to the board colors)</summary>
        <table id="${tableId}">
          <thead><tr><th>Move</th><th>Squares</th><th>Count</th><th>%</th><th>Avg CP loss</th><th>Quality</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="status-line">no data yet</td></tr>'}</tbody>
        </table>
      </details>
    </div>
  `;
}
