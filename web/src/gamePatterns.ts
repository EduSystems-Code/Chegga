// Chegga Web — game-pattern insights from data already synced
//
// Everything here runs over the raw GameRecord list — every synced game,
// not just the analyzed subset — since none of these need engine
// analysis: how a game ended, rating over time, opponent-strength
// performance, game length, and time-of-day patterns are all already
// sitting in the PGN/game record. Broader sample size than the
// engine-dependent stats for free. Only the "first mistake" one needs
// analyzed move data, since "mistake" is an engine judgment.

import { Chess } from "chess.js";
import type { GameRecord, MoveAnalysisRecord } from "./db";

// --- 1. How games actually end ---

export type EndingCategory = "checkmate" | "resignation" | "timeout" | "abandonment" | "draw" | "other";

const ENDING_CATEGORY: Record<string, EndingCategory> = {
  checkmated: "checkmate",
  resigned: "resignation",
  timeout: "timeout",
  abandoned: "abandonment",
  agreed: "draw",
  repetition: "draw",
  stalemate: "draw",
  insufficient: "draw",
  "50move": "draw",
  timevsinsufficient: "draw",
};

/** The informative code is whichever side's result ISN'T "win" — for a
 * decisive game that's the loser's code (how they actually lost); for a
 * draw both sides usually carry the same draw code anyway. */
function endingCategoryFor(game: GameRecord): EndingCategory {
  const code = game.whiteResult !== "win" ? game.whiteResult : game.blackResult;
  return ENDING_CATEGORY[code] ?? "other";
}

export interface EndingBreakdown {
  category: EndingCategory;
  count: number;
  share: number;
}

export function computeEndingBreakdown(games: GameRecord[]): EndingBreakdown[] {
  const counts = new Map<EndingCategory, number>();
  for (const game of games) {
    const cat = endingCategoryFor(game);
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const total = games.length;
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count);
}

// --- 2. Rating trajectory over time, per time class ---

export interface RatingPoint {
  endTime: number;
  rating: number;
}

export interface RatingTrajectory {
  timeClass: string;
  points: RatingPoint[]; // sorted by endTime ascending
}

/** Ratings aren't comparable across time classes (a 1800 bullet player
 * and a 1800 rapid player are different strengths — same note the
 * backend's strength model already makes), so this returns one series
 * per time class rather than one blended line. */
export function computeRatingTrajectory(games: GameRecord[]): RatingTrajectory[] {
  const byTimeClass = new Map<string, RatingPoint[]>();
  for (const game of games) {
    if (!game.rated) continue; // casual games don't move a rating, would just add noise
    const rating = game.userColor === "white" ? game.whiteRating : game.blackRating;
    const list = byTimeClass.get(game.timeClass) ?? [];
    list.push({ endTime: game.endTime, rating });
    byTimeClass.set(game.timeClass, list);
  }
  return Array.from(byTimeClass.entries())
    .map(([timeClass, points]) => ({ timeClass, points: points.sort((a, b) => a.endTime - b.endTime) }))
    .filter((t) => t.points.length >= 2) // one point isn't a trajectory
    .sort((a, b) => b.points.length - a.points.length);
}

// --- 3. Performance vs. opponent strength ---

export interface OpponentStrengthBucket {
  label: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
}

const STRENGTH_BANDS: [number, number, string][] = [
  [-Infinity, -200, "vs. much lower rated (200+ below you)"],
  [-200, -50, "vs. lower rated (50-200 below)"],
  [-50, 50, "vs. similar rated (±50)"],
  [50, 200, "vs. higher rated (50-200 above)"],
  [200, Infinity, "vs. much higher rated (200+ above)"],
];

export function computeOpponentStrengthPerformance(games: GameRecord[]): OpponentStrengthBucket[] {
  const buckets = new Map<string, { games: number; wins: number; losses: number; draws: number }>();

  for (const game of games) {
    const ownRating = game.userColor === "white" ? game.whiteRating : game.blackRating;
    const oppRating = game.userColor === "white" ? game.blackRating : game.whiteRating;
    if (!ownRating || !oppRating) continue;
    const diff = oppRating - ownRating;

    const band = STRENGTH_BANDS.find(([lo, hi]) => diff >= lo && diff < hi);
    if (!band) continue;
    const label = band[2];

    const entry = buckets.get(label) ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    entry.games += 1;
    if (game.userResult === "win") entry.wins += 1;
    else if (game.userResult === "loss") entry.losses += 1;
    else entry.draws += 1;
    buckets.set(label, entry);
  }

  return STRENGTH_BANDS.map(([, , label]) => {
    const e = buckets.get(label) ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    return { label, ...e, winRate: e.games ? Math.round((e.wins / e.games) * 1000) / 1000 : 0 };
  }).filter((b) => b.games > 0);
}

// --- 4. Game-length patterns ---

export interface GameLengthPatterns {
  avgLengthWin?: number;
  avgLengthLoss?: number;
  avgLengthDraw?: number;
}

/** "Length" is full moves (not plies) — the number most players actually
 * think in. Parsed from the PGN directly, so this works for every synced
 * game, analyzed or not. */
export function computeGameLengthPatterns(games: GameRecord[]): GameLengthPatterns {
  const byResult: Record<"win" | "loss" | "draw", number[]> = { win: [], loss: [], draw: [] };

  for (const game of games) {
    if (game.rules !== "chess" || !game.pgn) continue;
    let fullMoves: number;
    try {
      const chess = new Chess();
      chess.loadPgn(game.pgn);
      fullMoves = Math.ceil(chess.history().length / 2);
    } catch {
      continue; // a handful of PGNs (aborted games, export quirks) won't parse -- skip rather than crash the whole stat
    }
    byResult[game.userResult].push(fullMoves);
  }

  const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : undefined);
  return {
    avgLengthWin: avg(byResult.win),
    avgLengthLoss: avg(byResult.loss),
    avgLengthDraw: avg(byResult.draw),
  };
}

// --- 5. Time-of-day patterns ---

export interface TimeOfDayBucket {
  label: string;
  games: number;
  winRate: number;
}

const DAYPARTS: [number, number, string][] = [
  [5, 12, "morning (5am-12pm)"],
  [12, 17, "afternoon (12-5pm)"],
  [17, 21, "evening (5-9pm)"],
  [21, 29, "late night (9pm-5am)"], // 29 = 24+5, wraps past midnight
];

/** Local time of the viewer's own browser (chess.com's end_time is UTC,
 * converted here) — a personal pattern is more useful read against your
 * own clock than UTC. */
export function computeTimeOfDayPatterns(games: GameRecord[]): TimeOfDayBucket[] {
  const buckets = new Map<string, { games: number; wins: number }>();

  for (const game of games) {
    let hour = new Date(game.endTime * 1000).getHours();
    if (hour < 5) hour += 24; // fold 0-4am into the "late night" wraparound band
    const part = DAYPARTS.find(([lo, hi]) => hour >= lo && hour < hi);
    if (!part) continue;
    const label = part[2];
    const entry = buckets.get(label) ?? { games: 0, wins: 0 };
    entry.games += 1;
    if (game.userResult === "win") entry.wins += 1;
    buckets.set(label, entry);
  }

  return DAYPARTS.map(([, , label]) => {
    const e = buckets.get(label) ?? { games: 0, wins: 0 };
    return { label, games: e.games, winRate: e.games ? Math.round((e.wins / e.games) * 1000) / 1000 : 0 };
  }).filter((b) => b.games > 0);
}

// --- 6. Castling side chosen ---

export interface CastlingBreakdown {
  kingside: number;
  queenside: number;
  never: number;
}

export function computeCastlingBreakdown(games: GameRecord[]): CastlingBreakdown {
  const result: CastlingBreakdown = { kingside: 0, queenside: 0, never: 0 };

  for (const game of games) {
    if (game.rules !== "chess" || !game.pgn) continue;
    try {
      const chess = new Chess();
      chess.loadPgn(game.pgn);
      const ownColor = game.userColor === "white" ? "w" : "b";
      const castled = chess.history().find((san, i) => {
        const isOwnMove = (i % 2 === 0) === (ownColor === "w");
        return isOwnMove && (san === "O-O" || san === "O-O-O");
      });
      if (!castled) result.never += 1;
      else if (castled === "O-O") result.kingside += 1;
      else result.queenside += 1;
    } catch {
      continue;
    }
  }

  return result;
}

// --- 7. First-mistake ply (needs analyzed move data) ---

export function computeFirstMistakePly(games: GameRecord[], ownMoves: MoveAnalysisRecord[]): number | undefined {
  const gamesByUuid = new Map(games.map((g) => [g.chessComUuid, g]));
  const movesByGame = new Map<string, MoveAnalysisRecord[]>();
  for (const move of ownMoves) {
    if (!gamesByUuid.has(move.gameId)) continue;
    const list = movesByGame.get(move.gameId) ?? [];
    list.push(move);
    movesByGame.set(move.gameId, list);
  }

  const firstMistakePlies: number[] = [];
  for (const moves of movesByGame.values()) {
    const sorted = [...moves].sort((a, b) => a.ply - b.ply);
    const firstMistake = sorted.find((m) => m.classification === "mistake" || m.classification === "blunder");
    if (firstMistake) firstMistakePlies.push(firstMistake.ply);
  }

  if (firstMistakePlies.length === 0) return undefined;
  return Math.round((firstMistakePlies.reduce((a, b) => a + b, 0) / firstMistakePlies.length) * 10) / 10;
}
