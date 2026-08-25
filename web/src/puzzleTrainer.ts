// Chegga Web — blunder-replay puzzle trainer
//
// Turns the user's own real mistakes/blunders into puzzles: "here's the
// position right before you played it — find the better move." No new
// analysis needed, every field already exists on MoveAnalysisRecord
// (fenBefore, the move actually played, the engine's own best move) —
// this is purely a different lens on data Phase 2 already computed.

import type { GameRecord, MoveAnalysisRecord } from "./db";

export type Difficulty = "easy" | "medium" | "hard";

export interface Puzzle {
  id: string; // `${gameId}:${ply}`
  gameId: string;
  ply: number;
  fenBefore: string;
  sideToMove: "white" | "black";
  playedSan: string;
  playedUci: string;
  bestMoveUci: string;
  bestMoveSan: string;
  centipawnLoss: number;
  classification: string;
  difficulty: Difficulty;
  openingName?: string;
}

function difficultyFor(cpLoss: number): Difficulty {
  if (cpLoss < 150) return "easy";
  if (cpLoss < 400) return "medium";
  return "hard";
}

/** Only moves the engine can actually grade against a concrete "better
 * move" — needs a real bestMoveUci that differs from what was played, and
 * needs to have actually been a real mistake (mistake/blunder tier; a
 * "good"-tier move losing 40cp isn't a useful puzzle, it's noise). */
export function extractPuzzles(games: GameRecord[], ownMoves: MoveAnalysisRecord[]): Puzzle[] {
  const gamesByUuid = new Map(games.map((g) => [g.chessComUuid, g]));
  const puzzles: Puzzle[] = [];

  for (const move of ownMoves) {
    if (move.classification !== "mistake" && move.classification !== "blunder") continue;
    if (!move.bestMoveUci || !move.bestMoveSan) continue;
    if (move.bestMoveUci === move.uci) continue; // shouldn't happen given the classification gate, but a real guard costs nothing

    const game = gamesByUuid.get(move.gameId);
    puzzles.push({
      id: `${move.gameId}:${move.ply}`,
      gameId: move.gameId,
      ply: move.ply,
      fenBefore: move.fenBefore,
      sideToMove: move.sideToMove,
      playedSan: move.san,
      playedUci: move.uci,
      bestMoveUci: move.bestMoveUci,
      bestMoveSan: move.bestMoveSan,
      centipawnLoss: move.centipawnLoss,
      classification: move.classification,
      difficulty: difficultyFor(move.centipawnLoss),
      openingName: game?.openingName,
    });
  }

  return puzzles;
}
