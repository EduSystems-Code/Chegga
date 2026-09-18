// Chegga Web — game review: the step-through model behind the review screen
//
// The front page narrowed to one thing (2026-09-14): the single-game
// review moment. The grading already existed -- engineAnalysis.ts grades
// every move of every game -- but nothing let you look back at one game
// move by move, so the move-quality colors only ever appeared live, for
// one move, during a bot game. This module is the missing middle: it
// joins a PGN to the MoveAnalysisRecord[] that grading produced and
// hands back one step per half-move, ready to put on a board.
//
// Pure: no DOM, no engine, no storage. The view (gameReviewView.ts) and
// the wiring (main.ts) sit on top. Deliberately takes the records rather
// than the engine, so the same review works for a finished bot game, a
// pasted PGN, or a synced Chess.com game already analyzed in IndexedDB.

import { Chess, type Square } from "chess.js";
import type { MoveAnalysisRecord } from "./db";
import { CLASSIFICATION_ORDER } from "./classificationColors";

export interface ReviewStep {
  ply: number; // 1-based half-move, same convention as MoveAnalysisRecord.ply
  moveNumber: number; // 1-based full move ("12." / "12...")
  side: "white" | "black";
  isHuman: boolean; // the reviewer's own move, as opposed to the opponent's
  san: string;
  from: Square;
  to: Square;
  fenAfter: string; // the position this step puts on the board
  // Grading, present only when analysis covered this ply -- a partly
  // analyzed game still reviews, it just has ungraded steps.
  classification?: string;
  centipawnLoss?: number;
  bestMoveSan?: string;
  bestMoveUci?: string;
}

export interface ReviewGame {
  pgn: string; // kept so a caller can rebuild the real game (e.g. Undo after a review)
  startFen: string; // the position before ply 1 -- not always the standard start (handicap games)
  humanColor: "white" | "black";
  steps: ReviewStep[];
}

/** Board labels for a review, one per tier. Live play deliberately labels
 * only the top two tiers (encouragement while you're still playing --
 * see main.ts's MOVE_QUALITY_LABELS); a review is for finding out what
 * happened, so every tier says what it was. */
export const REVIEW_QUALITY_LABELS: Record<string, string> = {
  best: "Best!",
  excellent: "Excellent",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** Tiers where the engine's own preference is worth showing -- naming a
 * better move after a move that was already best/excellent/good is noise. */
const SHOW_BETTER_MOVE_FOR = new Set(["inaccuracy", "mistake", "blunder"]);

export function shouldShowBetterMove(step: ReviewStep): boolean {
  if (!step.classification || !step.bestMoveSan) return false;
  if (step.bestMoveSan === step.san) return false;
  return SHOW_BETTER_MOVE_FOR.has(step.classification);
}

/** One step per half-move of `pgn`, graded from whichever `moves` records
 * match by ply. Records for other games (or other plies) are ignored, so
 * passing a whole account's analysis rows is harmless. */
export function buildReview(
  pgn: string,
  moves: MoveAnalysisRecord[],
  humanColor: "white" | "black",
): ReviewGame {
  const chess = new Chess();
  chess.loadPgn(pgn);
  // A handicap/"from position" game carries its own start in the PGN
  // headers; chess.js writes FEN + SetUp there when a game didn't begin
  // from the standard position.
  const startFen = chess.getHeaders().FEN ?? new Chess().fen();
  const byPly = new Map(moves.map((m) => [m.ply, m]));

  const steps: ReviewStep[] = chess.history({ verbose: true }).map((move, i) => {
    const ply = i + 1;
    const side: "white" | "black" = move.color === "w" ? "white" : "black";
    const record = byPly.get(ply);
    // Guard against records from a different game sharing the ply number.
    const graded = record && record.san === move.san ? record : undefined;
    return {
      ply,
      moveNumber: Math.floor(i / 2) + 1,
      side,
      isHuman: side === humanColor,
      san: move.san,
      from: move.from,
      to: move.to,
      fenAfter: move.after,
      classification: graded?.classification,
      centipawnLoss: graded?.centipawnLoss,
      bestMoveSan: graded?.bestMoveSan,
      bestMoveUci: graded?.bestMoveUci,
    };
  });

  return { pgn, startFen, humanColor, steps };
}

/** How many of the reviewer's own moves landed in each tier, in the
 * shared CLASSIFICATION_ORDER. Tiers with no moves are left out. */
export function tallyHumanQuality(review: ReviewGame): { classification: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const step of review.steps) {
    if (!step.isHuman || !step.classification) continue;
    counts.set(step.classification, (counts.get(step.classification) ?? 0) + 1);
  }
  return CLASSIFICATION_ORDER.filter((c) => counts.has(c)).map((c) => ({
    classification: c,
    count: counts.get(c)!,
  }));
}

/** Index of the reviewer's costliest graded move, or -1 if the game has
 * none (nothing analyzed, or every own move was already best). This is
 * the "take me to the moment it went wrong" jump. */
export function worstHumanStepIndex(review: ReviewGame): number {
  let worst = -1;
  let worstLoss = 0;
  review.steps.forEach((step, i) => {
    if (!step.isHuman || step.centipawnLoss === undefined) return;
    if (step.centipawnLoss > worstLoss) {
      worstLoss = step.centipawnLoss;
      worst = i;
    }
  });
  return worst;
}

/** "12. Nf3" / "12... Nf6" — the way a move reads in a move list. */
export function moveLabel(step: ReviewStep): string {
  return `${step.moveNumber}.${step.side === "white" ? "" : ".."} ${step.san}`;
}

/** The caption under the board. `index` is -1 for the starting position. */
export function describeStep(review: ReviewGame, index: number): string {
  if (index < 0) {
    return review.steps.length
      ? "Starting position. Step forward to replay the game one move at a time."
      : "No moves to review yet.";
  }
  const step = review.steps[index];
  if (!step) return "";

  const parts = [moveLabel(step)];
  if (!step.isHuman) {
    parts.push("— your opponent's move.");
  } else if (!step.classification) {
    parts.push("— your move (not graded).");
  } else {
    const label = REVIEW_QUALITY_LABELS[step.classification] ?? step.classification;
    const loss = step.centipawnLoss ?? 0;
    // The top tier never quotes its centipawns: "Best!, 7cp lost" reads as
    // a contradiction, and a few centipawns off the engine's own line is
    // exactly what the tier already means. Every other tier shows the cost.
    // "Best!" also already ends in punctuation, so it gets no second mark.
    const showLoss = loss > 0 && step.classification !== "best";
    const tail = showLoss ? `, ${loss}cp lost.` : label.endsWith("!") ? "" : ".";
    parts.push(`— ${label}${tail}`);
    if (shouldShowBetterMove(step)) parts.push(`Engine preferred ${step.bestMoveSan}.`);
  }
  return parts.join(" ");
}
