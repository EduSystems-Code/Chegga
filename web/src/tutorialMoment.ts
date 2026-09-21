// Chegga Web — finding a move worth teaching from, in a visitor's own games
//
// The first-run tutorial needs one real position from the visitor's newest
// game where they missed something clear. Analyzing a whole game takes about
// half a minute, so this goes ply by ply, grades each of the visitor's own
// moves as soon as the position after it is known (ply i needs only the
// analysis of positions i and i+1), and stops at the first moment that is
// clear enough to explain. It skips the opening, where "mistakes" are mostly
// book deviations, and moves in positions that were already lost.
//
// Speed comes from a lighter engine setting than the full analysis (depth 12,
// one line). The tutorial re-checks the winner with the deeper heatmap search
// (`confirmMoment`) before showing it, so a shallow-search fluke is dropped.
//
// Engine and clock are passed in, so the logic is testable without either.

import { Chess, type Square } from "chess.js";
import type { AnalysisLine } from "./engine";
import type { GameRecord } from "./db";
import { classify, cpEquivalent, DISPLAY_CLAMP_CP, gamePhase, MATE_SCORE_CP } from "./engineAnalysis";
import { tagMove } from "./blunderTagger";
import { bestMoveClauseFor } from "./moveExplanation";
import { buildCandidates } from "./candidateMoves";

export interface TeachableMoment {
  id: string; // `${gameId}:${ply}`, the id a saved position from this game would have
  gameId: string;
  opponent: string;
  endTime: number; // unix seconds; 0 for the built-in example
  openingName?: string;
  userColor: "white" | "black";
  ply: number;
  moveNumber: number;
  fenBefore: string;
  previousMove?: { from: Square; to: Square }; // the opponent's move that led here, for the board highlight
  playedSan: string;
  playedUci: string;
  bestSan: string;
  bestUci: string;
  centipawnLoss: number;
  classification: string;
  blunderTag?: string;
  gamePhase: "opening" | "middlegame" | "endgame";
  // White-relative, the way MoveAnalysisRecord stores them.
  evalBeforeCp?: number;
  evalBeforeMate?: number;
  evalAfterCp?: number;
  evalAfterMate?: number;
  isExample: boolean;
}

/** The part of the engine this file uses. */
export interface EngineLike {
  analyse(fen: string, opts: { depth: number; multipv: number; movetimeMs?: number }): Promise<AnalysisLine[]>;
}

export const GOOD_SCORE = 5; // clear enough to stop looking
export const MIN_SCORE = 3; // the least we will teach from if nothing better turns up

export const SCAN_DEFAULTS = {
  depth: 12,
  movetimeMs: 250,
  minPly: 9, // the opening is mostly book; a "mistake" there is rarely a lesson
  budgetMs: 60_000, // across all games
};

// A move that loses less than this is not a lesson. A move that loses this
// much from a position that was already lost is not either.
const MIN_LOSS_CP = 150;
const MIN_EVAL_BEFORE_CP = -300;

export interface MomentFacts {
  centipawnLoss: number;
  blunderTag?: string;
  bestClause: string | null; // what the best move does, if it can be named
  evalBeforeMover: number; // centipawns, from the mover's side
}

/** How good a teaching position this is: a concrete reason (a piece left
 * hanging, a capture or mate missed) and a position that was still alive
 * score high. */
export function scoreMoment(f: MomentFacts): number {
  let score = 0;
  switch (f.blunderTag) {
    case "missed_mate":
    case "missed_capture":
    case "hung_material":
      score += 3;
      break;
    case "allowed_mate":
      score += 2;
      break;
    default:
      score += 1;
  }
  if (f.bestClause) score += 1;
  if (f.centipawnLoss >= 250 && f.centipawnLoss < 700) score += 2;
  else score += 1; // 150-249, or so large the position is lopsided
  if (f.evalBeforeMover >= -100) score += 1;
  return score;
}

function toWhiteRelative(line: AnalysisLine | undefined, sideToMoveAtLine: "white" | "black") {
  const sign = sideToMoveAtLine === "white" ? 1 : -1;
  return {
    cp: line?.scoreCp !== undefined ? line.scoreCp * sign : undefined,
    mate: line?.scoreMate !== undefined ? line.scoreMate * sign : undefined,
  };
}

export interface ScanResult {
  moment: TeachableMoment | null; // the first one clear enough to stop at
  best: TeachableMoment | null; // the highest-scoring one seen, if any reached MIN_SCORE
  bestScore: number;
  positionsAnalyzed: number;
  timedOut: boolean;
}

export interface ScanHooks {
  now?: () => number;
  /** called after each position is analyzed */
  onPosition?: (info: { positionsAnalyzed: number }) => void;
  shouldStop?: () => boolean;
}

export async function scanGameForMoment(
  engine: EngineLike,
  game: GameRecord,
  opts: typeof SCAN_DEFAULTS & { deadline?: number; exclude?: ReadonlySet<string> },
  hooks: ScanHooks = {},
): Promise<ScanResult> {
  const now = hooks.now ?? (() => performance.now());
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });

  const result: ScanResult = { moment: null, best: null, bestScore: 0, positionsAnalyzed: 0, timedOut: false };
  const analyses = new Map<number, AnalysisLine[]>(); // position index -> engine lines
  const analyse = async (index: number, fen: string) => {
    let lines = analyses.get(index);
    if (!lines) {
      lines = await engine.analyse(fen, { depth: opts.depth, multipv: 1, movetimeMs: opts.movetimeMs });
      analyses.set(index, lines);
      result.positionsAnalyzed += 1;
      hooks.onPosition?.({ positionsAnalyzed: result.positionsAnalyzed });
    }
    return lines;
  };

  // Position index i is the position before move i (0-based); the analysis
  // for a move needs positions i and i+1.
  for (let i = Math.max(0, opts.minPly - 1); i < history.length; i++) {
    if (hooks.shouldStop?.()) break;
    if (opts.deadline !== undefined && now() > opts.deadline) {
      result.timedOut = true;
      break;
    }
    const move = history[i];
    const side: "white" | "black" = move.color === "w" ? "white" : "black";
    if (side !== game.userColor) continue;

    const before = await analyse(i, move.before);
    const after = await analyse(i + 1, move.after);
    const bestLine = before[0];
    const bestUci = bestLine?.pv[0];
    const playedUci = move.from + move.to + (move.promotion ?? "");
    if (!bestLine || !bestUci || bestUci === playedUci) continue;

    const opponent: "white" | "black" = side === "white" ? "black" : "white";
    const afterBoard = new Chess(move.after);
    const beforeMover = cpEquivalent(bestLine.scoreCp, bestLine.scoreMate);
    // No line after the move means the game is over there: mate is the
    // mover's win, anything else (stalemate) is level.
    const afterMover = after[0]
      ? -cpEquivalent(after[0].scoreCp, after[0].scoreMate)
      : afterBoard.isCheckmate()
        ? MATE_SCORE_CP
        : 0;
    const centipawnLoss = Math.min(Math.max(0, beforeMover - afterMover), DISPLAY_CLAMP_CP);
    if (centipawnLoss < MIN_LOSS_CP || beforeMover < MIN_EVAL_BEFORE_CP) continue;

    let bestSan: string;
    try {
      bestSan = new Chess(move.before).move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci.slice(4) || undefined,
      }).san;
    } catch {
      continue; // the engine's move does not fit this position -- skip rather than guess
    }

    const phase = gamePhase(i + 1, new Chess(move.before));
    const classification = classify(centipawnLoss);
    const beforeWhite = toWhiteRelative(bestLine, side);
    const afterWhite = toWhiteRelative(after[0], opponent);
    const blunderTag = tagMove({
      fenBefore: move.before,
      uci: playedUci,
      san: move.san,
      bestMoveSan: bestSan,
      evalBeforeMate: beforeWhite.mate,
      evalAfterMate: afterWhite.mate,
      sideToMove: side,
      classification,
    });
    const score = scoreMoment({
      centipawnLoss,
      blunderTag,
      bestClause: bestMoveClauseFor(move.before, bestUci, phase),
      evalBeforeMover: beforeMover,
    });

    const previous = i > 0 ? history[i - 1] : undefined;
    const moment: TeachableMoment = {
      id: `${game.chessComUuid}:${i + 1}`,
      gameId: game.chessComUuid,
      opponent: game.userColor === "white" ? game.blackUsername : game.whiteUsername,
      endTime: game.endTime,
      openingName: game.openingName,
      userColor: game.userColor,
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      fenBefore: move.before,
      previousMove: previous ? { from: previous.from, to: previous.to } : undefined,
      playedSan: move.san,
      playedUci,
      bestSan,
      bestUci,
      centipawnLoss,
      classification,
      blunderTag,
      gamePhase: phase,
      evalBeforeCp: beforeWhite.cp,
      evalBeforeMate: beforeWhite.mate,
      evalAfterCp: afterWhite.cp,
      evalAfterMate: afterWhite.mate,
      isExample: false,
    };

    if (opts.exclude?.has(moment.id)) continue; // already tried and rejected by the deeper check
    if (score > result.bestScore && score >= MIN_SCORE) {
      result.best = moment;
      result.bestScore = score;
    }
    if (score >= GOOD_SCORE) {
      result.moment = moment;
      return result;
    }
  }
  return result;
}

/** Checks a moment against the deeper heatmap search of its position. The
 * shallow scan can be wrong; the tutorial should not build a lesson on it.
 * Returns the moment with the deeper search's best move, or null when the
 * deeper search does not agree that the played move was a real miss. */
export function confirmMoment(moment: TeachableMoment, deepLines: AnalysisLine[]): TeachableMoment | null {
  const candidates = buildCandidates(moment.fenBefore, deepLines);
  const best = candidates[0];
  if (!best) return null;
  if (best.uci === moment.playedUci) return null;
  const played = candidates.find((c) => c.uci === moment.playedUci);
  if (played) {
    if (played.gapCp < 120) return null;
  } else {
    // Outside the lines shown, so at least as bad as the last one shown. That
    // alone is proof when those lines already fall far short; otherwise trust
    // the shallow scan only for a big loss (a real blunder is rarely a top-8 move).
    const lastGap = candidates.at(-1)?.gapCp ?? 0;
    if (lastGap + 1 < 120 && moment.centipawnLoss < 300) return null;
  }
  return { ...moment, bestUci: best.uci, bestSan: best.san };
}

export interface FindResult {
  moment: TeachableMoment;
  game: GameRecord;
}

/** Looks through the newest games (newest first) for a teachable moment.
 * Gives up after `maxGames` games or when the shared time budget runs out. */
export async function findMomentInGames(
  engine: EngineLike,
  games: GameRecord[],
  opts: typeof SCAN_DEFAULTS & { maxGames?: number; exclude?: ReadonlySet<string> },
  hooks: ScanHooks & { onGame?: (info: { index: number; total: number; game: GameRecord }) => void } = {},
): Promise<FindResult | null> {
  const now = hooks.now ?? (() => performance.now());
  const deadline = now() + opts.budgetMs;
  const candidates = games
    .filter((g) => g.rules === "chess" && g.pgn.length > 0)
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, opts.maxGames ?? 3);

  let fallback: FindResult | null = null;
  let fallbackScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    const game = candidates[i];
    hooks.onGame?.({ index: i, total: candidates.length, game });
    let scan: ScanResult;
    try {
      scan = await scanGameForMoment(engine, game, { ...opts, deadline }, hooks);
    } catch {
      continue; // one game the engine or the PGN parser cannot read must not end the search
    }
    if (scan.moment) return { moment: scan.moment, game };
    if (scan.best && scan.bestScore > fallbackScore) {
      fallback = { moment: scan.best, game };
      fallbackScore = scan.bestScore;
    }
    if (scan.timedOut || hooks.shouldStop?.()) break;
  }
  return fallback;
}
