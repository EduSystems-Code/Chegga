// Chegga Web — headline insights derived from data already computed
// (Phase 3's profile aggregation, Phase 2's per-move analysis). Nothing
// here calls the engine or needs new data collection — it's the "so what"
// layer on top of numbers the app already has, per the training-tool
// brainstorm's "quick wins" category.

import type { GameRecord, MoveAnalysisRecord } from "./db";
import type { ProfileSummary } from "./profileService";

/** 0-100 accuracy score from average centipawn loss — NOT a reproduction
 * of lichess/chess.com's real (unpublished, win%-based) accuracy
 * formula; an earlier version of this function claimed to match their
 * shape using specific decay constants that were actually just made up
 * and produced nonsense (a solid ~1600-rated 53cp-average game scored
 * 7/100 — caught by actually running it against real data, not assumed
 * correct). This is a plain exponential decay, hand-picked and checked
 * at reference points instead: 0cp -> 100, ~20cp -> ~89, ~50cp -> ~75,
 * ~100cp -> ~56, ~200cp -> ~32 — a reasonable-looking curve, not a
 * claimed match to anyone's real algorithm. */
export function accuracyFromCpLoss(avgCentipawnLoss: number): number {
  const DECAY = 174; // solved so 50cp average lands at ~75/100
  const raw = 100 * Math.exp(-avgCentipawnLoss / DECAY);
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

export interface LeakHeadline {
  text: string;
  tag: string;
  count: number;
  share: number; // fraction of all taggable (mistake/blunder) moves
}

/** The single biggest recurring mistake pattern, phrased as one sentence
 * instead of making the reader parse a table. */
export function leakHeadline(profile: ProfileSummary): LeakHeadline | undefined {
  const entries = Object.entries(profile.blunderTagCounts);
  if (entries.length === 0) return undefined;
  const total = entries.reduce((sum, [, c]) => sum + c, 0);
  const [tag, count] = entries.sort((a, b) => b[1] - a[1])[0];
  const share = total ? count / total : 0;

  const phrasing: Record<string, string> = {
    hung_material: "leaving pieces hanging",
    missed_capture: "missing free captures",
    missed_mate: "missing forced mates",
    allowed_mate: "allowing forced mates",
    positional: "positional drift (no clean tactical story)",
  };

  return {
    text: `Your single biggest leak: ${phrasing[tag] ?? tag} — ${count} of your ${total} mistakes/blunders (${Math.round(share * 100)}%).`,
    tag,
    count,
    share,
  };
}

export interface WeakestPhase {
  phase: string;
  avgCentipawnLoss: number;
  text: string;
}

export function weakestPhase(profile: ProfileSummary): WeakestPhase | undefined {
  const entries = Object.entries(profile.phaseAvgCpLoss);
  if (entries.length === 0) return undefined;
  const [phase, avgCentipawnLoss] = entries.sort((a, b) => b[1] - a[1])[0];
  return {
    phase,
    avgCentipawnLoss,
    text: `Your ${phase} is where you lose the most: ${avgCentipawnLoss} cp/move on average, worse than your other phases.`,
  };
}

export interface OpeningWeakness {
  openingName: string;
  games: number;
  avgCentipawnLoss: number;
  winRate: number;
  text: string;
}

/** Per-opening avg cp-loss (something `profileService.ts`'s `topOpenings`
 * doesn't carry — that's just win/loss/draw counts) so this can name the
 * opening that's actually costing the most quality, not just the most
 * losses (an opening can lose a lot for reasons unrelated to how well
 * it's played). Openings with under `minGames` are skipped as too noisy
 * a sample to call out by name. */
export function weakestOpening(
  games: GameRecord[],
  ownMoves: MoveAnalysisRecord[],
  minGames = 2,
): OpeningWeakness | undefined {
  const gamesByUuid = new Map(games.map((g) => [g.chessComUuid, g]));

  const byOpening = new Map<string, { games: Set<string>; wins: number; cpSum: number; moveCount: number }>();
  for (const game of games) {
    if (!game.openingName) continue;
    const entry = byOpening.get(game.openingName) ?? { games: new Set(), wins: 0, cpSum: 0, moveCount: 0 };
    entry.games.add(game.chessComUuid);
    if (game.userResult === "win") entry.wins += 1;
    byOpening.set(game.openingName, entry);
  }

  for (const move of ownMoves) {
    const game = gamesByUuid.get(move.gameId);
    if (!game?.openingName) continue;
    const entry = byOpening.get(game.openingName);
    if (!entry) continue;
    entry.cpSum += move.centipawnLoss;
    entry.moveCount += 1;
  }

  const candidates = Array.from(byOpening.entries())
    .filter(([, e]) => e.games.size >= minGames && e.moveCount > 0)
    .map(([openingName, e]) => ({
      openingName,
      games: e.games.size,
      avgCentipawnLoss: Math.round((e.cpSum / e.moveCount) * 10) / 10,
      winRate: Math.round((e.wins / e.games.size) * 1000) / 1000,
    }))
    .sort((a, b) => b.avgCentipawnLoss - a.avgCentipawnLoss);

  if (candidates.length === 0) return undefined;
  const worst = candidates[0];
  return {
    ...worst,
    text: `Your play is weakest in "${worst.openingName}" — ${worst.avgCentipawnLoss} cp/move average over ${worst.games} game${worst.games === 1 ? "" : "s"} (${Math.round(worst.winRate * 100)}% win rate there).`,
  };
}

export interface TimePressureAlert {
  band: string;
  avgCentipawnLoss: number;
  blunderRate: number;
  exampleGameId?: string;
  exampleSan?: string;
  text: string;
}

/** The worst time-pressure band (by blunder rate, among bands with
 * actual data), plus one concrete example move from it — a stat is more
 * convincing with a real instance attached. */
export function timePressureAlert(profile: ProfileSummary, ownMoves: MoveAnalysisRecord[]): TimePressureAlert | undefined {
  const withData = profile.timePressureBreakdown.filter((b) => b.moves > 0);
  if (withData.length === 0) return undefined;
  const worst = [...withData].sort((a, b) => b.blunderRate - a.blunderRate)[0];
  if (worst.blunderRate === 0) return undefined; // nothing alarming to report

  const example = ownMoves
    .filter((m) => m.timePressureBand === worst.label && m.classification === "blunder")
    .sort((a, b) => b.centipawnLoss - a.centipawnLoss)[0];

  return {
    band: worst.label,
    avgCentipawnLoss: worst.avgCentipawnLoss,
    blunderRate: worst.blunderRate,
    exampleGameId: example?.gameId,
    exampleSan: example?.san,
    text: `You blunder ${Math.round(worst.blunderRate * 100)}% of the time when your clock is "${worst.label}"${example ? ` — e.g. ${example.san}` : ""}.`,
  };
}

// --- Rough rating-band context ---
//
// Deliberately NOT presented as precise science: these are illustrative
// ballparks reflecting the well-known general pattern (average
// centipawn-loss rises as rating falls), not a fitted model against a
// real labeled dataset. Framed to the reader as "rough public-pattern
// context," not a benchmark claim.
const ROUGH_ACPL_BANDS: [number, string][] = [
  [25, "~2200+ (expert/master territory)"],
  [40, "~1800-2200"],
  [60, "~1400-1800"],
  [90, "~1000-1400"],
  [Infinity, "under ~1000"],
];

export function roughRatingBandContext(avgCentipawnLoss: number): string {
  const band = ROUGH_ACPL_BANDS.find(([ceiling]) => avgCentipawnLoss <= ceiling)![1];
  return `An average centipawn loss around ${avgCentipawnLoss} cp is roughly in the ballpark players see at ${band} — a rough general pattern, not a precise rating estimate (that's what the strength model above is for).`;
}
