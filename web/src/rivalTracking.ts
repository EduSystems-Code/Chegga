// Chegga Web — rival/opponent tracking, the one real feature gap from the
// consolidation-plan.md inventory (my-brain vault).
//
// Ports the backend's real logic (backend/app/services/matchup_service.py):
// head-to-head records per opponent, filtered to MIN_RIVAL_GAMES so a
// one-off pairing doesn't get called a "rivalry." Rating-gap-vs-performance
// is deliberately NOT re-ported here -- gamePatterns.ts's
// computeOpponentStrengthPerformance already covers that exact stat
// (same bucket shape, already shipped), so porting it again would be
// straight duplication.
//
// Runs over every synced game (GameRecord), same as gamePatterns.ts --
// head-to-head doesn't need engine analysis, so it's available immediately
// after sync, not gated on how many games have been analyzed yet.

import type { GameRecord, RivalSnapshotEntry } from "./db";

const MIN_RIVAL_GAMES = 2; // matches matchup_service.py's own threshold

const RECENT_GAMES_WINDOW = 5;

export interface RivalRecord {
  opponent: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  lastPlayed: number; // endTime unix ms, most recent game
  allTimeAvgOpponentRating?: number; // undefined if no rated games against them
  recentAvgOpponentRating?: number; // avg over the most recent RECENT_GAMES_WINDOW rated games only -- an old game before a rival's rating moved shouldn't carry the same weight as a fresh one
}

function opponentOf(game: GameRecord): string {
  return game.userColor === "white" ? game.blackUsername : game.whiteUsername;
}

function opponentRatingOf(game: GameRecord): number {
  return game.userColor === "white" ? game.blackRating : game.whiteRating;
}

/** Head-to-head records, sorted by most-played first (matches the
 * backend's own sort) -- most-played is the more useful "who do I
 * actually keep running into" ordering than alphabetical or win-rate,
 * which would surface one-game flukes ahead of a real rivalry. */
export function computeRivalRecords(games: GameRecord[], limit = 20): RivalRecord[] {
  const byOpponent = new Map<string, GameRecord[]>();
  for (const game of games) {
    const opp = opponentOf(game);
    const list = byOpponent.get(opp) ?? [];
    list.push(game);
    byOpponent.set(opp, list);
  }

  const avg = (nums: number[]): number | undefined => (nums.length ? Math.round(nums.reduce((s, r) => s + r, 0) / nums.length) : undefined);

  const records: RivalRecord[] = [];
  for (const [opponent, oppGames] of byOpponent) {
    if (oppGames.length < MIN_RIVAL_GAMES) continue;
    let wins = 0,
      losses = 0,
      draws = 0,
      lastPlayed = 0;
    for (const g of oppGames) {
      if (g.userResult === "win") wins++;
      else if (g.userResult === "loss") losses++;
      else draws++;
      if (g.endTime > lastPlayed) lastPlayed = g.endTime;
    }

    // Rated ratings only, newest-first, so "recent" means the last N rated
    // games specifically -- an unrated friendly sitting between two rated
    // games shouldn't shift which games count as "recent."
    const ratedByRecency = oppGames
      .filter((g) => g.rated && opponentRatingOf(g))
      .sort((a, b) => b.endTime - a.endTime);
    const ratedRatings = ratedByRecency.map(opponentRatingOf);

    records.push({
      opponent,
      games: oppGames.length,
      wins,
      losses,
      draws,
      winRate: Math.round((wins / oppGames.length) * 1000) / 1000,
      lastPlayed,
      allTimeAvgOpponentRating: avg(ratedRatings),
      recentAvgOpponentRating: avg(ratedRatings.slice(0, RECENT_GAMES_WINDOW)),
    });
  }

  records.sort((a, b) => b.games - a.games);
  return records.slice(0, limit);
}

// --- Since-last-visit delta (critique #9) -------------------------------
//
// Rival tracking is a check-back feature — its whole value is "did I gain
// on them since last time." A stored snapshot per visit + this diff is
// the check-back hook. All client-side, a plain diff of two snapshots, no
// new data source.

/** The slim record persisted in a rival snapshot. */
export function snapshotEntry(r: RivalRecord): RivalSnapshotEntry {
  return {
    opponent: r.opponent,
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    winRate: r.winRate,
    recentAvgOpponentRating: r.recentAvgOpponentRating,
  };
}

export interface RivalDelta {
  opponent: string;
  newGames: number; // games played against them since the snapshot
  winsDelta: number;
  lossesDelta: number;
  drawsDelta: number;
  winRateDelta: number; // current.winRate - previous.winRate, -1..1
  opponentRatingDelta?: number; // change in their recent average rating, if both known
}

/** Per-rival change between a past snapshot and the current records.
 * Only rivals present in BOTH snapshots and with at least one new game
 * are returned — a rival you haven't faced since last visit has nothing
 * to report. Sorted most-new-games first. */
export function computeRivalDeltas(current: RivalRecord[], previous: RivalSnapshotEntry[]): RivalDelta[] {
  const prevByOpponent = new Map(previous.map((p) => [p.opponent, p]));
  const deltas: RivalDelta[] = [];
  for (const c of current) {
    const p = prevByOpponent.get(c.opponent);
    if (!p) continue;
    const newGames = c.games - p.games;
    if (newGames <= 0) continue;
    deltas.push({
      opponent: c.opponent,
      newGames,
      winsDelta: c.wins - p.wins,
      lossesDelta: c.losses - p.losses,
      drawsDelta: c.draws - p.draws,
      winRateDelta: Math.round((c.winRate - p.winRate) * 1000) / 1000,
      opponentRatingDelta:
        c.recentAvgOpponentRating !== undefined && p.recentAvgOpponentRating !== undefined
          ? c.recentAvgOpponentRating - p.recentAvgOpponentRating
          : undefined,
    });
  }
  deltas.sort((a, b) => b.newGames - a.newGames);
  return deltas;
}

export type RivalInsightTone = "strong" | "even" | "weak" | "neutral";

export interface RivalInsight {
  opponent: string;
  text: string;
  tone: RivalInsightTone;
}

/** The "give insight, not just a table" layer the user actually asked
 * for -- one plain-language read per rival, using only numbers already
 * computed above (no new data source, no invented formula). Purely
 * descriptive of what's already true in the record, same "measured, not
 * generated" spirit as statsInsights.ts and skillProfile.ts. */
export function computeRivalInsights(records: RivalRecord[]): RivalInsight[] {
  return records.map((r) => {
    if (r.wins === r.losses && r.draws === 0) {
      return { opponent: r.opponent, text: `Dead even across ${r.games} games — no edge either way yet.`, tone: "neutral" };
    }
    if (r.winRate >= 0.65) {
      return { opponent: r.opponent, text: `A real edge — ${r.wins}-${r.losses}-${r.draws} (${Math.round(r.winRate * 100)}% wins) across ${r.games} games.`, tone: "strong" };
    }
    if (r.winRate <= 0.35) {
      return { opponent: r.opponent, text: `A tough matchup — ${r.wins}-${r.losses}-${r.draws} (${Math.round(r.winRate * 100)}% wins) across ${r.games} games.`, tone: "weak" };
    }
    return { opponent: r.opponent, text: `Roughly even — ${r.wins}-${r.losses}-${r.draws} across ${r.games} games.`, tone: "even" };
  });
}
