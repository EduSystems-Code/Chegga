// Chegga Web — turning a reviewed position into a puzzle to keep
//
// The auto-extracted puzzles (puzzleTrainer.ts's extractPuzzles) are every
// mistake in every analyzed game. These are the ones a viewer chose while
// reviewing a game -- or the few worst moments of that game, saved in one
// tap. A saved puzzle carries everything practice needs (position, the
// move played, the engine's move), so it stays usable after the game
// itself is gone, and it works for a bot game, whose analysis isn't stored.
//
// Pure: no DOM, no storage. db.ts holds the store.

import type { ReviewGame, ReviewStep } from "./gameReview";
import { canPracticeStep } from "./gameReview";
import { difficultyFor, type Puzzle } from "./puzzleTrainer";

/** Same id extractPuzzles gives the same move (`${gameId}:${ply}`), so a
 * saved position and the auto-extracted one share spaced-repetition
 * progress. A bot game has no stored id, so its positions are keyed by the
 * position and the move. */
export function puzzleIdFor(review: ReviewGame, step: ReviewStep): string {
  if (review.gameId) return `${review.gameId}:${step.ply}`;
  const position = step.fenBefore.split(" ").slice(0, 4).join(" ");
  return `bot:${position}:${step.uci}`;
}

export function puzzleFromStep(review: ReviewGame, step: ReviewStep, openingName?: string): Puzzle | null {
  if (!canPracticeStep(step) || !step.bestMoveUci || !step.bestMoveSan) return null;
  const loss = step.centipawnLoss ?? 0;
  return {
    id: puzzleIdFor(review, step),
    gameId: review.gameId ?? "bot",
    ply: step.ply,
    fenBefore: step.fenBefore,
    sideToMove: step.side,
    playedSan: step.san,
    playedUci: step.uci,
    bestMoveUci: step.bestMoveUci,
    bestMoveSan: step.bestMoveSan,
    centipawnLoss: loss,
    classification: step.classification ?? "mistake",
    difficulty: difficultyFor(loss),
    openingName,
    gamePhase: step.gamePhase ?? "middlegame",
    blunderTag: step.blunderTag,
  };
}

/** A short line for a saved-position card: "Middlegame · lost 2.3 pawns". */
export function describeSavedPuzzle(p: Puzzle): string {
  const phase = p.gamePhase.charAt(0).toUpperCase() + p.gamePhase.slice(1);
  return `${phase} · lost ${(p.centipawnLoss / 100).toFixed(1)} pawns with ${p.playedSan}`;
}
