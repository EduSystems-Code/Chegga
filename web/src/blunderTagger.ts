// Chegga Web — WHY a mistake/blunder happened (Phase 2)
//
// Ported from Chegga's own `app/services/blunder_tagger.py::tag_move`, same
// priority order and same "hanging" approximation (undefended, or defended
// only by pieces worth more than a cheaper attacker) — not a full
// static-exchange evaluator, deliberately, per the backend's own note.

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

export const MISSED_MATE = "missed_mate"; // a forced mate was available and you didn't play it
export const ALLOWED_MATE = "allowed_mate"; // your move let the opponent force mate
export const HUNG_MATERIAL = "hung_material"; // a piece of yours is now capturable for less than it's worth
export const MISSED_CAPTURE = "missed_capture"; // the engine's best move was a capture and you played something else
export const POSITIONAL = "positional"; // none of the above

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100, // never actually hangs, but keeps the value lookup total
};

const TAGGABLE_CLASSIFICATIONS = new Set(["mistake", "blunder"]);

function isHanging(board: Chess, square: Square, pieceColor: Color): boolean {
  const piece = board.get(square);
  if (!piece || piece.type === "k") return false;

  const opponent: Color = pieceColor === "w" ? "b" : "w";
  const attackers = board.attackers(square, opponent);
  if (attackers.length === 0) return false;

  const defenders = board.attackers(square, pieceColor);
  if (defenders.length === 0) return true;

  const cheapestAttacker = Math.min(...attackers.map((sq) => PIECE_VALUES[board.get(sq)!.type]));
  return cheapestAttacker < PIECE_VALUES[piece.type];
}

/** Exported for reuse beyond blunder-tagging: the vision-drill trainer
 * ("is anything hanging?") and the optional live hang-warning during bot
 * games both want the same "is this side about to lose material for
 * free" check, not a reimplementation of it. */
export function hasHangingPiece(board: Chess, color: Color): boolean {
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell && cell.color === color && isHanging(board, cell.square, color)) return true;
    }
  }
  return false;
}

export interface TagMoveArgs {
  fenBefore: string;
  uci: string;
  san: string;
  bestMoveSan?: string;
  evalBeforeMate?: number;
  evalAfterMate?: number;
  sideToMove: "white" | "black";
  classification: string;
}

export function tagMove(args: TagMoveArgs): string | undefined {
  if (!TAGGABLE_CLASSIFICATIONS.has(args.classification)) return undefined;

  const moverSign = args.sideToMove === "white" ? 1 : -1;
  const bestBeforeMoverMate = args.evalBeforeMate !== undefined ? args.evalBeforeMate * moverSign : undefined;
  const afterMoverMate = args.evalAfterMate !== undefined ? args.evalAfterMate * moverSign : undefined;

  if (bestBeforeMoverMate !== undefined && bestBeforeMoverMate > 0) return MISSED_MATE;
  if (afterMoverMate !== undefined && afterMoverMate < 0) return ALLOWED_MATE;

  const board = new Chess(args.fenBefore);
  const moverColor = board.turn();
  board.move({ from: args.uci.slice(0, 2), to: args.uci.slice(2, 4), promotion: args.uci.slice(4) || undefined });
  if (hasHangingPiece(board, moverColor)) return HUNG_MATERIAL;

  if (args.bestMoveSan?.includes("x") && !args.san.includes("x")) return MISSED_CAPTURE;

  return POSITIONAL;
}
