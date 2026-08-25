// Chegga Web — client-side strength estimate (Phase 4)
//
// Per the phase plan's Phase 4 decision: NOT a ported scikit-learn
// RandomForest (no server to run it on) — a simple weighted-heuristic
// formula (a frozen, offline-trained Ridge regression; see
// strengthCoefficients.ts) over the same feature set the backend's real
// `strength_model.py::extract_features` defines. Explicitly labeled in
// the UI as an estimate, not the backend's cross-validated model.

import type { GameRecord, MoveAnalysisRecord } from "./db";
import { STRENGTH_MODEL } from "./strengthCoefficients";

const MIN_OWN_MOVES = 5; // shorter games (aborts, early resigns) are too noisy a sample to featurize

export interface StrengthEstimate {
  estimatedRating: number;
  cvMae: number;
  cvR2: number;
  trainedOnGames: number;
}

/** own_moves must already be filtered to this game's user_color side —
 * same precondition as the backend's `extract_features`. Returns
 * undefined if there isn't enough signal (too short a game), matching
 * the backend's `MIN_OWN_MOVES` gate. */
export function extractFeatures(game: GameRecord, ownMoves: MoveAnalysisRecord[]): Record<string, number> | undefined {
  const n = ownMoves.length;
  if (n < MIN_OWN_MOVES) return undefined;

  const counts: Record<string, number> = { blunder: 0, mistake: 0, inaccuracy: 0, good: 0, excellent: 0, best: 0 };
  let cpLossSum = 0;
  for (const m of ownMoves) {
    counts[m.classification] = (counts[m.classification] ?? 0) + 1;
    cpLossSum += m.centipawnLoss;
  }

  const phaseLosses: Record<string, number[]> = { opening: [], middlegame: [], endgame: [] };
  for (const m of ownMoves) {
    if (m.gamePhase in phaseLosses) phaseLosses[m.gamePhase].push(m.centipawnLoss);
  }
  const phaseAvg = (phase: string) => {
    const losses = phaseLosses[phase];
    return losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  };

  const timeClasses = ["bullet", "blitz", "rapid", "daily"];

  return {
    avg_cp_loss: cpLossSum / n,
    blunder_rate: (counts.blunder ?? 0) / n,
    mistake_rate: (counts.mistake ?? 0) / n,
    inaccuracy_rate: (counts.inaccuracy ?? 0) / n,
    good_rate: (counts.good ?? 0) / n,
    excellent_rate: (counts.excellent ?? 0) / n,
    best_rate: (counts.best ?? 0) / n,
    opening_avg_cp_loss: phaseAvg("opening"),
    middlegame_avg_cp_loss: phaseAvg("middlegame"),
    endgame_avg_cp_loss: phaseAvg("endgame"),
    num_own_moves: n,
    is_white: game.userColor === "white" ? 1 : 0,
    ...Object.fromEntries(timeClasses.map((tc) => [`time_class_${tc}`, game.timeClass === tc ? 1 : 0])),
  };
}

export function estimateStrength(game: GameRecord, ownMoves: MoveAnalysisRecord[]): StrengthEstimate | undefined {
  const features = extractFeatures(game, ownMoves);
  if (!features) return undefined;

  const { featureNames, scalerMean, scalerScale, coefficients, intercept, cvMae, cvR2, trainedOnGames } =
    STRENGTH_MODEL;

  let rating = intercept;
  featureNames.forEach((name, i) => {
    const raw = features[name] ?? 0;
    const normalized = (raw - scalerMean[i]) / (scalerScale[i] || 1);
    rating += coefficients[i] * normalized;
  });

  return { estimatedRating: Math.round(rating), cvMae, cvR2, trainedOnGames };
}
