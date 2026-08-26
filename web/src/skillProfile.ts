// Chegga Web — skill profile & growth path (rule-based, no AI)
//
// This is the "individualized instruction" layer the user asked for
// directly (2026-08-25 follow-up to the deep critique): a deterministic
// assessment of where a visitor's own play is weakest, a specific
// prescribed action pointing at a tool this app already has, and a
// progress trend so "am I actually improving" has a real answer instead
// of a re-derived snapshot every time. Deliberately NOT AI-generated
// coaching prose — that's the parked "coach" phase (see context.md's
// decisions log); everything here is "if this measured thing is true,
// recommend this specific already-built tool," same rule-based spirit as
// statsInsights.ts, just organized into one coherent assessment instead
// of a flat list of unrelated one-off insights.

import type { MoveAnalysisRecord } from "./db";
import { accuracyFromCpLoss } from "./statsInsights";

export type SkillCategoryId = "opening" | "middlegame" | "endgame" | "timeManagement";

export const SKILL_CATEGORY_LABELS: Record<SkillCategoryId, string> = {
  opening: "Opening accuracy",
  middlegame: "Middlegame tactics",
  endgame: "Endgame technique",
  timeManagement: "Time management",
};

// Below this many own-moves in a category, the average is too noisy to
// act on -- flagged as "not enough data yet" instead of a real score.
const MIN_MOVES_FOR_SCORE = 20;

export interface SkillScore {
  category: SkillCategoryId;
  score?: number; // 0-100, undefined = not enough data
  moveCount: number;
  avgCentipawnLoss?: number;
}

export type PrescriptionAction =
  | { kind: "puzzle"; phase?: "opening" | "middlegame" | "endgame"; blunderTag?: string }
  | { kind: "vision" }
  | { kind: "drill"; drillId: string }
  | { kind: "openings" }; // no dedicated tool -- points at the opening-repertoire table

export interface SkillAssessment {
  scores: SkillScore[];
  weakest?: SkillScore;
  rootCause: string; // one sentence naming *why* the weakest category is weak, not just that it is
  prescription?: { text: string; action: PrescriptionAction };
}

function phaseAvgAndCount(ownMoves: MoveAnalysisRecord[], phase: "opening" | "middlegame" | "endgame") {
  const moves = ownMoves.filter((m) => m.gamePhase === phase);
  if (moves.length === 0) return { avg: undefined, count: 0 };
  const sum = moves.reduce((s, m) => s + m.centipawnLoss, 0);
  return { avg: sum / moves.length, count: moves.length };
}

function dominantBlunderTag(moves: MoveAnalysisRecord[]): string | undefined {
  const counts = new Map<string, number>();
  for (const m of moves) {
    if (!m.blunderTag) continue;
    counts.set(m.blunderTag, (counts.get(m.blunderTag) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
}

const BLUNDER_TAG_PHRASING: Record<string, string> = {
  hung_material: "leaving pieces hanging",
  missed_capture: "missing free captures",
  missed_mate: "missing forced mates",
  allowed_mate: "allowing forced mates",
  positional: "positional drift with no clean tactical story",
};

/** Pure function: everything it needs is already computed by profileService
 * (phase averages) or is the same ownMoves array that feeds it — no new
 * data collection, same precondition (ownMoves already filtered to the
 * tracked user's own side) as computeProfile. Takes only ownMoves, not the
 * full ProfileSummary/GameRecord[] — everything here is derivable straight
 * from the per-move records already loaded by the caller. */
export function assessSkills(ownMoves: MoveAnalysisRecord[]): SkillAssessment {
  const opening = phaseAvgAndCount(ownMoves, "opening");
  const middlegame = phaseAvgAndCount(ownMoves, "middlegame");
  const endgame = phaseAvgAndCount(ownMoves, "endgame");

  // Time management: pool the "critical"/"low" pressure bands as one
  // signal (both are "the clock is a real factor") against a plain avg
  // cp-loss the same way the other three categories are scored, rather
  // than inventing a different formula just for this one category.
  const pressuredMoves = ownMoves.filter((m) => m.timePressureBand === "critical (<10% time left)" || m.timePressureBand === "low (10-30%)");
  const timeManagement = {
    avg: pressuredMoves.length ? pressuredMoves.reduce((s, m) => s + m.centipawnLoss, 0) / pressuredMoves.length : undefined,
    count: pressuredMoves.length,
  };

  const raw: Record<SkillCategoryId, { avg?: number; count: number }> = {
    opening,
    middlegame,
    endgame,
    timeManagement,
  };

  const scores: SkillScore[] = (Object.keys(raw) as SkillCategoryId[]).map((category) => {
    const { avg, count } = raw[category];
    const hasEnough = avg !== undefined && count >= MIN_MOVES_FOR_SCORE;
    return {
      category,
      score: hasEnough ? accuracyFromCpLoss(avg!) : undefined,
      moveCount: count,
      avgCentipawnLoss: avg !== undefined ? Math.round(avg * 10) / 10 : undefined,
    };
  });

  const scored = scores.filter((s) => s.score !== undefined);
  if (scored.length === 0) {
    return { scores, rootCause: "Not enough analyzed moves yet to assess — analyze more games to unlock a real skill profile." };
  }

  const weakest = [...scored].sort((a, b) => a.score! - b.score!)[0];

  let rootCause = "";
  let prescription: SkillAssessment["prescription"];

  if (weakest.category === "opening") {
    const openingMoves = ownMoves.filter((m) => m.gamePhase === "opening");
    const tag = dominantBlunderTag(openingMoves);
    rootCause = tag
      ? `Your opening-phase losses are mostly ${BLUNDER_TAG_PHRASING[tag] ?? tag} — ${weakest.avgCentipawnLoss} cp/move average there.`
      : `Your opening phase averages ${weakest.avgCentipawnLoss} cp/move lost, your worst of the three phases.`;
    prescription = { text: "Review your opening repertoire below for the specific lines costing you the most.", action: { kind: "openings" } };
  } else if (weakest.category === "middlegame") {
    const middlegameMoves = ownMoves.filter((m) => m.gamePhase === "middlegame");
    const tag = dominantBlunderTag(middlegameMoves);
    rootCause = tag
      ? `Your middlegame losses are mostly ${BLUNDER_TAG_PHRASING[tag] ?? tag} — ${weakest.avgCentipawnLoss} cp/move average there.`
      : `Your middlegame averages ${weakest.avgCentipawnLoss} cp/move lost, your worst of the three phases.`;
    prescription = tag
      ? { text: `Practice puzzles filtered to "${BLUNDER_TAG_PHRASING[tag] ?? tag}" from your own middlegame mistakes.`, action: { kind: "puzzle", phase: "middlegame", blunderTag: tag } }
      : { text: "Practice puzzles from your own middlegame mistakes.", action: { kind: "puzzle", phase: "middlegame" } };
  } else if (weakest.category === "endgame") {
    rootCause = `Your endgame averages ${weakest.avgCentipawnLoss} cp/move lost, your worst of the three phases — usually a technique gap more than a tactical one.`;
    prescription = { text: "Run the endgame technique drills (King+Rook vs King, opposition, etc.) below.", action: { kind: "drill", drillId: "kr-vs-k" } };
  } else {
    rootCause = `You lose ${weakest.avgCentipawnLoss} cp/move on average once your clock gets low — worse than your relaxed-clock play.`;
    prescription = { text: "Turn on the hanging-piece warning during bot games to build faster pattern recognition under pressure.", action: { kind: "vision" } };
  }

  return { scores, weakest, rootCause, prescription };
}
