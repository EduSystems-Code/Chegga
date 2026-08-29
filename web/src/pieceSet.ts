// Chegga Web — swappable chess piece set.
//
// The boards originally rendered pieces as Unicode glyphs only (a
// deliberate "original art, not reproduced" call). That's now one of
// three options: two real SVG sets (Cburnett, Merida) bundled from the
// freely-licensed sets Lichess ships -- see public/piece/COPYING.md for
// authors + GPLv2+ license -- and the original Unicode glyphs as
// "Classic". Default is Cburnett. Per-viewer localStorage, same tier as
// board theme / sound.

export type PieceSetId = "cburnett" | "merida" | "unicode";

const KEY = "chegga-web:piece-set";
const DEFAULT: PieceSetId = "cburnett";

export const PIECE_SET_OPTIONS: { id: PieceSetId; label: string }[] = [
  { id: "cburnett", label: "Cburnett" },
  { id: "merida", label: "Merida" },
  { id: "unicode", label: "Classic (text)" },
];

export const PIECE_GLYPH: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

export function getPieceSet(): PieceSetId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "cburnett" || v === "merida" || v === "unicode") return v;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function setPieceSet(id: PieceSetId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** URL for one piece's SVG in the active (or given) set, or null for the
 * Unicode set. `color` is "w"|"b", `type` is "p".."k" (chess.js style). */
export function pieceImgUrl(color: string, type: string, set: PieceSetId = getPieceSet()): string | null {
  if (set === "unicode") return null;
  return `${import.meta.env.BASE_URL}piece/${set}/${color}${type.toUpperCase()}.svg`;
}

/** Piece markup for an HTML board square (playBoard.ts). Returns an <img>
 * for the SVG sets, or the original <span class="play-piece ..."> for
 * Unicode so all the existing gradient/stroke styling still applies. */
export function playPieceHtml(
  color: string,
  type: string,
  opts: { dim?: boolean; ghost?: boolean } = {},
): string {
  const dimStyle = opts.dim ? "opacity:0.35" : "";
  const url = pieceImgUrl(color, type);
  if (url) {
    const cls = opts.ghost ? "piece-img piece-img-ghost" : "piece-img";
    return `<img class="${cls}" src="${url}" alt="" draggable="false" style="${dimStyle}" />`;
  }
  const glyph = PIECE_GLYPH[color + type] ?? "";
  const colorClass = color === "w" ? "play-piece-white" : "play-piece-black";
  const extra = opts.ghost ? "" : ` style="${dimStyle}"`;
  return `<span class="play-piece ${colorClass}"${extra}>${glyph}</span>`;
}

/** Piece markup for the SVG opening-explorer board (openingBoard.ts):
 * an <image> for the SVG sets, else a <text> glyph. `cx`/`cy` are the
 * square centre in the SVG's own coordinate space. */
export function svgPiecePart(
  color: string,
  type: string,
  cx: number,
  cy: number,
  square: number,
  opacity: number,
  glyphFill: string,
): string {
  const url = pieceImgUrl(color, type);
  if (url) {
    const s = square * 0.9;
    return `<image href="${url}" x="${(cx - s / 2).toFixed(1)}" y="${(cy - s / 2).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" opacity="${opacity}" />`;
  }
  const glyph = PIECE_GLYPH[color + type] ?? "";
  return `<text x="${cx}" y="${cy + 12}" font-size="38" text-anchor="middle" fill="${glyphFill}" opacity="${opacity}">${glyph}</text>`;
}
