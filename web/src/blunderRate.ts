// Chegga Web — blunder rate as a single headline metric over time
//
// Below ~2000, the biggest single rating leak is one-move oversights, not
// deep positional errors. This isolates that: blunders per 100 of your
// own moves, split out into "oversights" (hung a piece, missed a free
// capture, walked into / missed a mate) vs. all blunders, plotted month
// by month against a target line. All from data Phase 2 already computed
// — no engine calls.

import type { GameRecord, MoveAnalysisRecord } from "./db";

// blunderTag values that mean "a concrete thing was on the board and got
// missed in one move" — the trainable kind.
const OVERSIGHT_TAGS = new Set(["hung_material", "missed_capture", "missed_mate", "allowed_mate"]);

export interface BlunderRatePoint {
  month: string; // "YYYY-MM"
  moves: number;
  blundersPer100: number;
  oversightsPer100: number;
}

export interface BlunderRateSummary {
  totalMoves: number;
  blundersPer100: number;
  oversightsPer100: number;
  monthly: BlunderRatePoint[]; // chronological
  targetPer100: number; // rough "expert" reference
  trend?: number; // first→last monthly blundersPer100 delta (needs ≥2 months); negative = improving
}

function monthOf(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function computeBlunderRate(analyzedGames: GameRecord[], ownMoves: MoveAnalysisRecord[]): BlunderRateSummary | undefined {
  if (ownMoves.length === 0) return undefined;

  const monthByGame = new Map(analyzedGames.map((g) => [g.chessComUuid, monthOf(g.endTime)]));

  const buckets = new Map<string, { moves: number; blunders: number; oversights: number }>();
  let totalBlunders = 0;
  let totalOversights = 0;

  for (const m of ownMoves) {
    const month = monthByGame.get(m.gameId) ?? "unknown";
    const b = buckets.get(month) ?? { moves: 0, blunders: 0, oversights: 0 };
    b.moves += 1;
    const isBlunder = m.classification === "blunder";
    const isOversight = (isBlunder || m.classification === "mistake") && m.blunderTag !== undefined && OVERSIGHT_TAGS.has(m.blunderTag);
    if (isBlunder) {
      b.blunders += 1;
      totalBlunders += 1;
    }
    if (isOversight) {
      b.oversights += 1;
      totalOversights += 1;
    }
    buckets.set(month, b);
  }

  const monthly: BlunderRatePoint[] = Array.from(buckets.entries())
    .filter(([month, b]) => month !== "unknown" && b.moves >= 20) // a month with <20 analyzed own-moves is too noisy to plot
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, b]) => ({
      month,
      moves: b.moves,
      blundersPer100: Math.round((b.blunders / b.moves) * 1000) / 10,
      oversightsPer100: Math.round((b.oversights / b.moves) * 1000) / 10,
    }));

  const trend =
    monthly.length >= 2
      ? Math.round((monthly[monthly.length - 1].blundersPer100 - monthly[0].blundersPer100) * 10) / 10
      : undefined;

  return {
    totalMoves: ownMoves.length,
    blundersPer100: Math.round((totalBlunders / ownMoves.length) * 1000) / 10,
    oversightsPer100: Math.round((totalOversights / ownMoves.length) * 1000) / 10,
    monthly,
    targetPer100: 3.0, // ~expert territory — a handful of true blunders per 100 moves
    trend,
  };
}
