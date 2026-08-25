// Chegga Web — move-frequency "spider web" data layer
//
// Aggregates EVERY own move across every analyzed game (not just the
// opening move) by (from, to) square pair, split by which color the user
// played. Each move also gets a representative quality tier (best →
// blunder, same thresholds as engineAnalysis.ts's classify()) computed
// from its own average centipawn loss, so the board can encode two things
// at once: how often you play a move (opacity/width) and how well it
// tends to go for you (color) — per the user's own explicit ask.
//
// Scales to "every game a person has ever played on Chess.com" the same
// way Phase 1/3 already do: this operates on whatever's already synced
// and analyzed in IndexedDB for a username, so a bigger synced history
// just means a bigger input array, not different code.

import type { GameRecord, MoveAnalysisRecord } from "./db";
import { classify } from "./engineAnalysis";

export interface MoveFrequency {
  uci: string;
  from: string; // e.g. "e2"
  to: string; // e.g. "e4"
  san: string;
  count: number;
  avgCentipawnLoss: number;
  classification: string; // best/excellent/good/inaccuracy/mistake/blunder
}

export interface OpeningFrequency {
  white: MoveFrequency[]; // sorted by count desc
  black: MoveFrequency[];
  totalWhiteGames: number;
  totalBlackGames: number;
}

interface Accumulator {
  uci: string;
  from: string;
  to: string;
  san: string;
  count: number;
  cpLossSum: number;
}

function accumulate(acc: Map<string, Accumulator>, move: MoveAnalysisRecord): void {
  const existing = acc.get(move.uci);
  if (existing) {
    existing.count += 1;
    existing.cpLossSum += move.centipawnLoss;
  } else {
    acc.set(move.uci, {
      uci: move.uci,
      from: move.uci.slice(0, 2),
      to: move.uci.slice(2, 4),
      san: move.san,
      count: 1,
      cpLossSum: move.centipawnLoss,
    });
  }
}

function finalizeMoves(acc: Map<string, Accumulator>): MoveFrequency[] {
  return Array.from(acc.values())
    .map((a) => {
      const avgCentipawnLoss = a.cpLossSum / a.count;
      return {
        uci: a.uci,
        from: a.from,
        to: a.to,
        san: a.san,
        count: a.count,
        avgCentipawnLoss,
        classification: classify(avgCentipawnLoss),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** `ownMoves` should be the same "moves the tracked user actually played"
 * set profileService.ts's computeProfile expects (side_to_move ===
 * game.user_color). Every ply counts, not just the opening move. */
export function computeOpeningFrequency(games: GameRecord[], ownMoves: MoveAnalysisRecord[]): OpeningFrequency {
  const gamesByUuid = new Map(games.map((g) => [g.chessComUuid, g]));

  const whiteAcc = new Map<string, Accumulator>();
  const blackAcc = new Map<string, Accumulator>();
  let totalWhiteGames = 0;
  let totalBlackGames = 0;

  for (const game of games) {
    if (game.userColor === "white") totalWhiteGames++;
    else totalBlackGames++;
  }

  for (const move of ownMoves) {
    const game = gamesByUuid.get(move.gameId);
    if (!game) continue;
    accumulate(game.userColor === "white" ? whiteAcc : blackAcc, move);
  }

  return {
    white: finalizeMoves(whiteAcc),
    black: finalizeMoves(blackAcc),
    totalWhiteGames,
    totalBlackGames,
  };
}

export interface DepthFrequency {
  depth: number; // 1-indexed: your 1st own move of the game, your 2nd, ...
  white: MoveFrequency[];
  black: MoveFrequency[];
  totalWhiteGames: number; // games where you (as White) reached this depth
  totalBlackGames: number;
}

/**
 * "Stack games on top of each other": groups by which own-move-number a
 * move was (your 1st move, your 2nd move, ...) rather than lumping every
 * ply together — depth 1 across every game shows what you tend to open
 * with, depth 2 shows your typical follow-up, and so on. Index is by the
 * user's OWN move count within the game (not raw ply), so White's move 1
 * and Black's reply both land on depth 1 -- "your Nth move," regardless
 * of color, matching how a player actually thinks about "my first move,
 * my second move."
 */
export function computeMoveFrequencyByDepth(games: GameRecord[], ownMoves: MoveAnalysisRecord[]): DepthFrequency[] {
  const gamesByUuid = new Map(games.map((g) => [g.chessComUuid, g]));

  const movesByGame = new Map<string, MoveAnalysisRecord[]>();
  for (const move of ownMoves) {
    const list = movesByGame.get(move.gameId) ?? [];
    list.push(move);
    movesByGame.set(move.gameId, list);
  }
  for (const list of movesByGame.values()) list.sort((a, b) => a.ply - b.ply);

  const whiteAccByDepth = new Map<number, Map<string, Accumulator>>();
  const blackAccByDepth = new Map<number, Map<string, Accumulator>>();
  const whiteGamesByDepth = new Map<number, Set<string>>();
  const blackGamesByDepth = new Map<number, Set<string>>();

  for (const [gameId, moves] of movesByGame) {
    const game = gamesByUuid.get(gameId);
    if (!game) continue;

    const accByDepth = game.userColor === "white" ? whiteAccByDepth : blackAccByDepth;
    const gamesByDepth = game.userColor === "white" ? whiteGamesByDepth : blackGamesByDepth;

    moves.forEach((move, i) => {
      const depth = i + 1;
      if (!accByDepth.has(depth)) accByDepth.set(depth, new Map());
      accumulate(accByDepth.get(depth)!, move);

      if (!gamesByDepth.has(depth)) gamesByDepth.set(depth, new Set());
      gamesByDepth.get(depth)!.add(gameId);
    });
  }

  const maxDepth = Math.max(0, ...whiteAccByDepth.keys(), ...blackAccByDepth.keys());
  const result: DepthFrequency[] = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    result.push({
      depth,
      white: finalizeMoves(whiteAccByDepth.get(depth) ?? new Map()),
      black: finalizeMoves(blackAccByDepth.get(depth) ?? new Map()),
      totalWhiteGames: whiteGamesByDepth.get(depth)?.size ?? 0,
      totalBlackGames: blackGamesByDepth.get(depth)?.size ?? 0,
    });
  }
  return result;
}

/** Keeps only the top N most-frequent destination moves per origin
 * square, so the board stays legible as the synced history grows into
 * hundreds/thousands of distinct moves — per the user's own call to cap
 * it rather than draw every arrow that ever happened. Everything is
 * still in the un-capped list for the table view. */
export function topMovesPerOrigin(moves: MoveFrequency[], perOriginLimit: number): MoveFrequency[] {
  const byOrigin = new Map<string, MoveFrequency[]>();
  for (const move of moves) {
    const list = byOrigin.get(move.from) ?? [];
    list.push(move);
    byOrigin.set(move.from, list);
  }

  const kept: MoveFrequency[] = [];
  for (const list of byOrigin.values()) {
    kept.push(...list.slice(0, perOriginLimit)); // already sorted by count desc
  }
  return kept.sort((a, b) => b.count - a.count);
}
