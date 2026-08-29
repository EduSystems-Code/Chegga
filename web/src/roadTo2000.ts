// Chegga Web — "Road to a target rating"
//
// Inverts the frozen strength model (strengthCoefficients.ts) into a
// rating-gap attribution: given your averaged play-quality features and a
// target rating, which specific areas are costing you the most model
// points, and roughly how many. This is deliberately NOT presented as
// precise — the underlying Ridge model only explains ~14% of rating
// variance (cvR2 0.137). It's a directional "here's where the model
// thinks your points are hiding," pointed at tools this app already has.

import type { GameRecord, MoveAnalysisRecord } from "./db";
import { extractFeatures } from "./strengthEstimate";
import { STRENGTH_MODEL } from "./strengthCoefficients";

export type RoadArea =
  | "opening_avg_cp_loss"
  | "middlegame_avg_cp_loss"
  | "endgame_avg_cp_loss"
  | "blunder_rate"
  | "best_rate";

export interface RoadFactor {
  area: RoadArea;
  label: string;
  currentValue: number; // human-readable (cp for phases, % for rates)
  targetValue: number;
  pointsGain: number; // model rating points gained by reaching the benchmark
  practice: string; // one line: what to actually do
  action: RoadAction;
}

export type RoadAction =
  | { kind: "openings" }
  | { kind: "puzzle"; phase?: "opening" | "middlegame" | "endgame" }
  | { kind: "drill" }
  | { kind: "vision" };

export interface RoadToTarget {
  currentEstimate: number;
  target: number;
  gap: number;
  factors: RoadFactor[]; // only areas where you're worse than the target benchmark, ranked by pointsGain
  explainedPoints: number; // sum of factors' pointsGain
}

// Two reference levels for the actionable features. A target rating is
// linearly interpolated (and mildly extrapolated) between them. These are
// hand-set from well-known centipawn-loss / accuracy patterns by strength
// — not fitted to a labelled dataset, same honesty caveat as
// statsInsights.ts's rough rating bands.
const ANCHOR_LOW = { rating: 1400, opening_avg_cp_loss: 42, middlegame_avg_cp_loss: 84, endgame_avg_cp_loss: 92, blunder_rate: 0.11, best_rate: 0.36 };
const ANCHOR_HIGH = { rating: 2200, opening_avg_cp_loss: 12, middlegame_avg_cp_loss: 24, endgame_avg_cp_loss: 30, blunder_rate: 0.02, best_rate: 0.58 };

type AnchorKey = Exclude<keyof typeof ANCHOR_LOW, "rating">;

function benchmarkFor(target: number, key: AnchorKey): number {
  const t = (target - ANCHOR_LOW.rating) / (ANCHOR_HIGH.rating - ANCHOR_LOW.rating);
  const clamped = Math.max(-0.25, Math.min(1.25, t)); // allow slight extrapolation, not runaway
  return ANCHOR_LOW[key] + clamped * (ANCHOR_HIGH[key] - ANCHOR_LOW[key]);
}

const AREA_META: Record<RoadArea, { label: string; practice: string; action: RoadAction; isRate: boolean }> = {
  opening_avg_cp_loss: { label: "Opening accuracy", practice: "Drill your own most-played lines in the opening repertoire table.", action: { kind: "openings" }, isRate: false },
  middlegame_avg_cp_loss: { label: "Middlegame accuracy", practice: "Work tactics puzzles from your own middlegame mistakes.", action: { kind: "puzzle", phase: "middlegame" }, isRate: false },
  endgame_avg_cp_loss: { label: "Endgame technique", practice: "Run the endgame technique drills (Lucena, opposition, Q vs R).", action: { kind: "drill" }, isRate: false },
  blunder_rate: { label: "Blunder rate", practice: "Use the vision trainer and the in-game hanging-piece warning to cut one-move oversights.", action: { kind: "vision" }, isRate: true },
  best_rate: { label: "Finding the best move", practice: "Solve themed puzzles at your rating — full lines, no hints — to raise your best-move hit rate.", action: { kind: "puzzle" }, isRate: true },
};

/** Weighted-average each model feature across the analyzed games (weight =
 * that game's own-move count), so a 90-move grind counts more than a
 * 6-move miniature — same spirit as how computeProfile pools per-move. */
export function averageFeatures(analyzedGames: GameRecord[], ownMoves: MoveAnalysisRecord[]): Record<string, number> | undefined {
  const byGame = new Map<string, MoveAnalysisRecord[]>();
  for (const m of ownMoves) {
    const arr = byGame.get(m.gameId) ?? [];
    arr.push(m);
    byGame.set(m.gameId, arr);
  }

  const sums: Record<string, number> = {};
  let weight = 0;
  for (const game of analyzedGames) {
    const moves = byGame.get(game.chessComUuid) ?? [];
    const f = extractFeatures(game, moves);
    if (!f) continue;
    const w = moves.length;
    weight += w;
    for (const [k, v] of Object.entries(f)) sums[k] = (sums[k] ?? 0) + v * w;
  }
  if (weight === 0) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sums)) out[k] = v / weight;
  return out;
}

export function computeRoadToTarget(
  features: Record<string, number>,
  currentEstimate: number,
  target: number,
): RoadToTarget {
  const { featureNames, scalerMean, scalerScale, coefficients } = STRENGTH_MODEL;
  const idx = (name: string) => featureNames.indexOf(name as (typeof featureNames)[number]);

  const factors: RoadFactor[] = [];
  for (const area of Object.keys(AREA_META) as RoadArea[]) {
    const i = idx(area);
    if (i < 0) continue;
    const current = features[area] ?? 0;
    const bench = benchmarkFor(target, area as AnchorKey);

    const currentNorm = (current - scalerMean[i]) / (scalerScale[i] || 1);
    const benchNorm = (bench - scalerMean[i]) / (scalerScale[i] || 1);
    const pointsGain = coefficients[i] * (benchNorm - currentNorm);

    // A positive gain means moving toward the benchmark helps. Ignore
    // areas where you're already at or past the target level, and tiny
    // sub-3-point noise.
    if (pointsGain < 3) continue;

    const meta = AREA_META[area];
    factors.push({
      area,
      label: meta.label,
      currentValue: meta.isRate ? Math.round(current * 1000) / 10 : Math.round(current * 10) / 10,
      targetValue: meta.isRate ? Math.round(bench * 1000) / 10 : Math.round(bench * 10) / 10,
      pointsGain: Math.round(pointsGain),
      practice: meta.practice,
      action: meta.action,
    });
  }

  factors.sort((a, b) => b.pointsGain - a.pointsGain);
  const explainedPoints = factors.reduce((s, f) => s + f.pointsGain, 0);

  return {
    currentEstimate: Math.round(currentEstimate),
    target,
    gap: Math.round(target - currentEstimate),
    factors,
    explainedPoints,
  };
}
