// Chegga Web — canned endgame drills + odds-game starting positions
//
// No personal data needed for these — standard technique positions any
// player benefits from drilling. Completion is detected for free by
// PlayBoard's existing getStatus() (checkmate/stalemate/draw), since
// every drill here is playable from an arbitrary FEN the same way a real
// game is — no special-cased "did you win the endgame" logic needed.

import { Chess } from "chess.js";

export interface EndgameDrill {
  id: string;
  name: string;
  fen: string;
  practicingColor: "white" | "black"; // which side the human should play to practice the technique
  objective: string;
}

export const ENDGAME_DRILLS: EndgameDrill[] = [
  {
    id: "kq-vs-k",
    name: "King + Queen vs. King",
    fen: "4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1",
    practicingColor: "white",
    objective: "Checkmate with just a queen and king — the most common winning technique.",
  },
  {
    id: "kr-vs-k",
    name: "King + Rook vs. King",
    fen: "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1",
    practicingColor: "white",
    objective: "Checkmate with just a rook and king — box the king to the edge.",
  },
  {
    id: "kbb-vs-k",
    name: "King + Two Bishops vs. King",
    fen: "4k3/8/8/8/8/8/8/BB2K3 w - - 0 1",
    practicingColor: "white",
    objective: "Checkmate with two bishops — the classic diagonal-boxing technique, meaningfully harder than Q or R.",
  },
  {
    id: "kp-vs-k-opposition",
    name: "King + Pawn vs. King (opposition)",
    fen: "8/8/8/4k3/8/4P3/4K3 w - - 0 1",
    practicingColor: "white",
    objective: "Escort the pawn to promotion using the opposition — the pawn-endgame fundamental.",
  },
  {
    id: "kn-vs-kp",
    name: "Defend: King + Knight vs. King + Pawn",
    fen: "8/8/4k3/8/3p4/8/3N4/4K3 b - - 0 1",
    practicingColor: "black",
    objective: "Black to move: stop White's knight from either winning the pawn or holding it back — a real defensive test.",
  },
  {
    id: "lucena",
    name: "Rook endgame: the Lucena position (win)",
    fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    practicingColor: "white",
    objective: "The most important winning rook endgame. Promote the pawn by 'building a bridge' with your rook to block the checks.",
  },
  {
    id: "philidor",
    name: "Rook endgame: the Philidor defence (draw)",
    fen: "3k4/R7/3KP3/8/8/8/8/5r2 b - - 0 1",
    practicingColor: "black",
    objective: "Black to move and hold the draw: keep your rook on the third rank until the pawn advances, then check from behind.",
  },
  {
    id: "kp-distant-opposition",
    name: "King + Pawn: distant opposition (win)",
    fen: "8/8/8/3k4/8/8/3P4/3K4 w - - 0 1",
    practicingColor: "white",
    objective: "Win by taking the opposition before pushing the pawn — a step early or late and it's only a draw.",
  },
  {
    id: "q-vs-r",
    name: "Queen vs. Rook (win)",
    fen: "8/8/8/8/8/2k5/1r6/2KQ4 w - - 0 1",
    practicingColor: "white",
    objective: "The Philidor position in Q vs R. Win by forcing the defending king and rook apart — a hard technique worth knowing.",
  },
  {
    id: "kpp-connected",
    name: "King + two connected pawns vs. King (win)",
    fen: "8/8/8/3k4/8/3PP3/8/3K4 w - - 0 1",
    practicingColor: "white",
    objective: "Escort the connected passers to promotion — keep them side by side so they defend each other.",
  },
];

export const ODDS_OPTIONS = [
  { value: "none", label: "None (even game)" },
  { value: "q", label: "Bot plays without its queen" },
  { value: "r", label: "Bot plays without a rook" },
  { value: "n", label: "Bot plays without a knight" },
  { value: "b", label: "Bot plays without a bishop" },
] as const;

/** A standard game start with one piece removed from the bot's own side
 * — an odds/handicap game. Removing via chess.js's own `remove()` rather
 * than hand-editing the FEN string also gets castling-rights cleanup for
 * free when a rook is removed (confirmed: removing a1's rook drops the
 * queenside castling right automatically). */
export function oddsFen(pieceToRemove: "q" | "r" | "n" | "b" | "none", botColor: "white" | "black"): string {
  const chess = new Chess();
  if (pieceToRemove === "none") return chess.fen();

  const rank = botColor === "white" ? "1" : "8";
  // Queenside instance for the pieces that come in pairs -- an arbitrary
  // but consistent choice (kingside removal would work identically).
  const file: Record<"q" | "r" | "n" | "b", string> = { q: "d", r: "a", n: "b", b: "c" };
  chess.remove(`${file[pieceToRemove]}${rank}` as any);
  return chess.fen();
}
