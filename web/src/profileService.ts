// Chegga Web — profile & pattern stats (Phase 3)
//
// Ported from Chegga's own `app/services/profile_service.py::compute_profile`
// and `time_pressure_service.py::time_pressure_breakdown`. The backend does
// every aggregation as a SQL GROUP BY so it stays fast at low-millions of
// rows; there's no SQL-in-the-browser equivalent here, so this is plain JS
// reducers over arrays already pulled from IndexedDB (`db.ts`'s
// `getGamesByUsername` / `getMoveAnalysesForGames`) — same bucket
// definitions and thresholds, just computed differently, per the phase
// plan's explicit call that per-visitor game counts don't need a mini
// query engine to stay fast.

import type { GameRecord, MoveAnalysisRecord } from "./db";

export interface OpeningStat {
  openingName: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface MonthlyStat {
  yearMonth: string; // "YYYY-MM"
  games: number;
  avgCentipawnLoss: number;
  blunderRate: number; // blunders per game
}

export interface TimePressureBucket {
  label: string;
  moves: number;
  avgCentipawnLoss: number;
  blunderRate: number;
}

export interface ProfileSummary {
  gamesAnalyzed: number;
  totalMoves: number;
  avgCentipawnLoss: number;
  classificationCounts: Record<string, number>;
  classificationRate: Record<string, number>; // as a fraction of totalMoves
  phaseAvgCpLoss: Record<string, number>; // opening/middlegame/endgame
  colorAvgCpLoss: Record<string, number>; // white/black
  timeClassBreakdown: Record<string, number>;
  topOpenings: OpeningStat[];
  blunderTagCounts: Record<string, number>;
  monthlyTrend: MonthlyStat[];
  timePressureBreakdown: TimePressureBucket[];
}

const TIME_PRESSURE_BAND_ORDER = [
  "critical (<10% time left)",
  "low (10-30%)",
  "comfortable (30-70%)",
  "plenty (>70%)",
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function avgBy<T>(items: T[], keyOf: (item: T) => string | undefined, valueOf: (item: T) => number): Record<string, number> {
  const sums = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    sums.set(key, (sums.get(key) ?? 0) + valueOf(item));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const [key, sum] of sums) out[key] = round1(sum / (counts.get(key) ?? 1));
  return out;
}

/**
 * Pure aggregator: `ownMoves` must already be filtered to moves the
 * tracked user actually played (side_to_move === game.user_color), and
 * `analyzedGames` to games with `analyzed === true` — same preconditions
 * the backend's queries encode via their own WHERE/JOIN clauses.
 */
export function computeProfile(analyzedGames: GameRecord[], ownMoves: MoveAnalysisRecord[]): ProfileSummary {
  const classificationCounts: Record<string, number> = {};
  let totalCpLoss = 0;
  for (const move of ownMoves) {
    classificationCounts[move.classification] = (classificationCounts[move.classification] ?? 0) + 1;
    totalCpLoss += move.centipawnLoss;
  }
  const totalMoves = ownMoves.length;

  const classificationRate: Record<string, number> = {};
  for (const [label, count] of Object.entries(classificationCounts)) {
    classificationRate[label] = totalMoves ? round3(count / totalMoves) : 0;
  }

  const blunderTagCounts: Record<string, number> = {};
  for (const move of ownMoves) {
    if (!move.blunderTag) continue;
    blunderTagCounts[move.blunderTag] = (blunderTagCounts[move.blunderTag] ?? 0) + 1;
  }

  const phaseAvgCpLoss = avgBy(ownMoves, (m) => m.gamePhase, (m) => m.centipawnLoss);
  const colorAvgCpLoss = avgBy(
    ownMoves,
    (m) => (m.sideToMove === "white" ? "white" : "black"),
    (m) => m.centipawnLoss,
  );

  const gamesAnalyzed = new Set(ownMoves.map((m) => m.gameId)).size;

  const timeClassBreakdown: Record<string, number> = {};
  for (const game of analyzedGames) {
    timeClassBreakdown[game.timeClass] = (timeClassBreakdown[game.timeClass] ?? 0) + 1;
  }

  const openingStats = new Map<string, OpeningStat>();
  for (const game of analyzedGames) {
    if (!game.openingName) continue;
    const stat = openingStats.get(game.openingName) ?? {
      openingName: game.openingName,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    stat.games += 1;
    if (game.userResult === "win") stat.wins += 1;
    else if (game.userResult === "loss") stat.losses += 1;
    else stat.draws += 1;
    openingStats.set(game.openingName, stat);
  }
  // Secondary sort key breaks ties deterministically (alphabetical on
  // opening name) -- without one, a tie right at the top-10 cutoff picks a
  // different "10th" opening on every recompute, which reads as a bug once
  // an account has enough games for ties to be common (previously
  // undefined; flagged during Phase 3 verification).
  const topOpenings = Array.from(openingStats.values())
    .sort((a, b) => b.games - a.games || a.openingName.localeCompare(b.openingName))
    .slice(0, 10);

  // Monthly trend: months come from games' end_time (chart labels every
  // played month), stats come from own moves in games ending that month.
  const gamesByUuid = new Map(analyzedGames.map((g) => [g.chessComUuid, g]));
  const monthOf = (unixSeconds: number) => {
    const d = new Date(unixSeconds * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  const gamesByMonth = new Map<string, number>();
  for (const game of analyzedGames) {
    const ym = monthOf(game.endTime);
    gamesByMonth.set(ym, (gamesByMonth.get(ym) ?? 0) + 1);
  }

  const cpSumByMonth = new Map<string, number>();
  const moveCountByMonth = new Map<string, number>();
  const blunderCountByMonth = new Map<string, number>();
  for (const move of ownMoves) {
    const game = gamesByUuid.get(move.gameId);
    if (!game) continue;
    const ym = monthOf(game.endTime);
    cpSumByMonth.set(ym, (cpSumByMonth.get(ym) ?? 0) + move.centipawnLoss);
    moveCountByMonth.set(ym, (moveCountByMonth.get(ym) ?? 0) + 1);
    if (move.classification === "blunder") blunderCountByMonth.set(ym, (blunderCountByMonth.get(ym) ?? 0) + 1);
  }

  const monthlyTrend: MonthlyStat[] = Array.from(moveCountByMonth.keys())
    .sort()
    .map((ym) => {
      const games = gamesByMonth.get(ym) ?? 0;
      const moves = moveCountByMonth.get(ym) ?? 0;
      return {
        yearMonth: ym,
        games,
        avgCentipawnLoss: moves ? round1((cpSumByMonth.get(ym) ?? 0) / moves) : 0,
        blunderRate: games ? round2((blunderCountByMonth.get(ym) ?? 0) / games) : 0,
      };
    });

  const bandCounts = new Map<string, { moves: number; cpSum: number; blunders: number }>();
  for (const move of ownMoves) {
    if (!move.timePressureBand) continue;
    const bucket = bandCounts.get(move.timePressureBand) ?? { moves: 0, cpSum: 0, blunders: 0 };
    bucket.moves += 1;
    bucket.cpSum += move.centipawnLoss;
    if (move.classification === "blunder") bucket.blunders += 1;
    bandCounts.set(move.timePressureBand, bucket);
  }
  const timePressureBreakdown: TimePressureBucket[] = TIME_PRESSURE_BAND_ORDER.map((label) => {
    const bucket = bandCounts.get(label);
    return {
      label,
      moves: bucket?.moves ?? 0,
      avgCentipawnLoss: bucket && bucket.moves ? round1(bucket.cpSum / bucket.moves) : 0,
      blunderRate: bucket && bucket.moves ? round3(bucket.blunders / bucket.moves) : 0,
    };
  });

  return {
    gamesAnalyzed,
    totalMoves,
    avgCentipawnLoss: totalMoves ? round1(totalCpLoss / totalMoves) : 0,
    classificationCounts,
    classificationRate,
    phaseAvgCpLoss,
    colorAvgCpLoss,
    timeClassBreakdown,
    topOpenings,
    blunderTagCounts,
    monthlyTrend,
    timePressureBreakdown,
  };
}
