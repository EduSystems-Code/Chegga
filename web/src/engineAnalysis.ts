// Chegga Web — per-move engine analysis (Phase 2)
//
// Ported from Chegga's own `app/services/engine_analysis.py::analyze_game`.
// For a game with n plies this runs n+1 engine analyses (one per board
// position, including the start and the final position), same as the
// backend — eval_before for the move played at ply i comes from position
// i's top line, eval_after comes from position i+1's top line (the REAL
// resulting position), not derived out of position i's MultiPV list.
//
// One real protocol difference from the Python port: raw UCI reports
// `score cp`/`score mate` from the side-to-move's own perspective at the
// analysed position, not White-relative the way python-chess's
// `PovScore.white()` does the conversion for us. This module does that
// conversion itself (`toWhiteRelativeCp`) before storing, so the stored
// fields keep the same White-relative convention as the backend's
// `MoveAnalysis` model.

import { Chess } from "chess.js";
import type { AnalysisLine, Engine } from "./engine";
import type { GameRecord, MoveAnalysisRecord } from "./db";
import { clocksByFen } from "./clockParser";
import { tagMove } from "./blunderTagger";
import { bandFor } from "./timePressure";

const MATE_SCORE_CP = 100_000;
const DISPLAY_CLAMP_CP = 1000; // caps mate-adjacent blowups so a single move can't dominate a chart

// Our own explicit, tunable convention — there is no industry-standard
// definition of these labels. Centipawn loss thresholds, mover's
// perspective, lowest to highest. Carried over unchanged from the
// backend so the two products agree on what "a blunder" means.
const CLASSIFICATION_THRESHOLDS: [number, string][] = [
  [10, "best"],
  [25, "excellent"],
  [50, "good"],
  [100, "inaccuracy"],
  [200, "mistake"],
];
const BLUNDER = "blunder";

export function classify(centipawnLoss: number): string {
  for (const [threshold, label] of CLASSIFICATION_THRESHOLDS) {
    if (centipawnLoss <= threshold) return label;
  }
  return BLUNDER;
}

export function gamePhase(ply: number, board: Chess): "opening" | "middlegame" | "endgame" {
  if (ply <= 20) return "opening";
  let nonPawnKingMaterial = 0;
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell && cell.type !== "p" && cell.type !== "k") nonPawnKingMaterial += 1;
    }
  }
  return nonPawnKingMaterial <= 6 ? "endgame" : "middlegame";
}

/** cp equivalent for a mate score — mirrors python-chess's
 * `score.score(mate_score=MATE_SCORE_CP)`, which substitutes a large
 * magnitude for "mate in N" so cp math never has to special-case it (the
 * later clamp to DISPLAY_CLAMP_CP means the exact magnitude doesn't
 * matter, only the sign and that it dwarfs any real cp value). */
function toWhiteRelativeCp(line: AnalysisLine | undefined, sideToMoveAtLine: "white" | "black"): number {
  if (!line) return 0;
  const raw = line.scoreMate !== undefined ? Math.sign(line.scoreMate || 1) * MATE_SCORE_CP : (line.scoreCp ?? 0);
  return sideToMoveAtLine === "white" ? raw : -raw;
}

function whiteRelativeMate(line: AnalysisLine | undefined, sideToMoveAtLine: "white" | "black"): number | undefined {
  if (!line || line.scoreMate === undefined) return undefined;
  return sideToMoveAtLine === "white" ? line.scoreMate : -line.scoreMate;
}

export interface AnalysisOptions {
  depth: number; // Chegga's backend default: 14
  multipv: number; // Chegga's backend default: 3
  movetimeMs?: number; // Chegga's backend default: 300 — same two-bound Limit as chess.engine.Limit(depth, time)
}

export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = { depth: 14, multipv: 3, movetimeMs: 300 };

export async function analyzeGame(
  engine: Engine,
  game: GameRecord,
  opts: AnalysisOptions = DEFAULT_ANALYSIS_OPTIONS,
): Promise<MoveAnalysisRecord[]> {
  const pgnGame = new Chess();
  pgnGame.loadPgn(game.pgn);
  const clockByFen = clocksByFen(pgnGame.getComments());
  const sanMoves = pgnGame.history();

  const board = new Chess();
  const boardsByPly: Chess[] = [new Chess(board.fen())];
  const positionsInfo: AnalysisLine[][] = [await engine.analyse(board.fen(), opts)];

  const uciMoves: string[] = [];
  for (const san of sanMoves) {
    const move = board.move(san);
    uciMoves.push(move.from + move.to + (move.promotion ?? ""));
    boardsByPly.push(new Chess(board.fen()));
    positionsInfo.push(await engine.analyse(board.fen(), opts));
  }

  const results: MoveAnalysisRecord[] = [];

  for (let i = 0; i < sanMoves.length; i++) {
    const boardBefore = boardsByPly[i];
    const sideToMove: "white" | "black" = boardBefore.turn() === "w" ? "white" : "black";
    const moverSign = sideToMove === "white" ? 1 : -1;

    const linesBefore = positionsInfo[i];
    const bestLine = linesBefore[0];
    const bestCpWhite = toWhiteRelativeCp(bestLine, sideToMove);
    const bestMateWhite = whiteRelativeMate(bestLine, sideToMove);

    const afterSideToMove: "white" | "black" = sideToMove === "white" ? "black" : "white";
    const afterLine = positionsInfo[i + 1][0];
    const afterCpWhite = toWhiteRelativeCp(afterLine, afterSideToMove);
    const afterMateWhite = whiteRelativeMate(afterLine, afterSideToMove);

    const bestBeforeMover = bestCpWhite * moverSign;
    const actualAfterMover = afterCpWhite * moverSign;
    const centipawnLoss = Math.min(Math.max(0, bestBeforeMover - actualAfterMover), DISPLAY_CLAMP_CP);

    const uci = uciMoves[i];
    const moveRankLine = linesBefore.find((line) => line.pv[0] === uci);
    const moveRank = moveRankLine?.multipv;
    const bestPvMove = bestLine?.pv[0];

    const ply = i + 1;
    const san = sanMoves[i];
    let bestMoveSan: string | undefined;
    if (bestPvMove) {
      const probe = new Chess(boardBefore.fen());
      try {
        const m = probe.move({ from: bestPvMove.slice(0, 2), to: bestPvMove.slice(2, 4), promotion: bestPvMove.slice(4) || undefined });
        bestMoveSan = m.san;
      } catch {
        bestMoveSan = undefined; // engine's PV move didn't parse against this position — leave unset rather than guess
      }
    }

    const classification = classify(centipawnLoss);
    const clockSeconds = clockByFen.get(boardsByPly[i + 1].fen());

    results.push({
      gameId: game.chessComUuid,
      ply,
      sideToMove,
      fenBefore: boardBefore.fen(),
      san,
      uci,
      evalBeforeCp: bestCpWhite,
      evalBeforeMate: bestMateWhite,
      evalAfterCp: afterCpWhite,
      evalAfterMate: afterMateWhite,
      bestMoveUci: bestPvMove,
      bestMoveSan,
      centipawnLoss,
      moveRank,
      classification,
      gamePhase: gamePhase(ply, boardBefore),
      blunderTag: tagMove({
        fenBefore: boardBefore.fen(),
        uci,
        san,
        bestMoveSan,
        evalBeforeMate: bestMateWhite,
        evalAfterMate: afterMateWhite,
        sideToMove,
        classification,
      }),
      clockSeconds,
      timePressureBand: bandFor(clockSeconds, game.timeControl),
    });
  }

  return results;
}
