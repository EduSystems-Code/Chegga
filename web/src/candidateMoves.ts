// Chegga Web — candidate moves for one position, and how to draw them
//
// The best-move heatmap. The engine already supports MultiPV (ranked lines
// per position); the review just never asked for more than the top line.
// This turns one position's ranked lines into candidates -- each with the
// same tier the whole app already uses (engineAnalysis.ts's `classify`, on
// how far the move falls short of the best one) -- and then into what a
// board can draw: a tint on the destination of every strong candidate, and
// a few arrows.
//
// Pure: no DOM, no engine call. candidateAnalysis.ts fetches the lines.

import { Chess, type Square } from "chess.js";
import type { AnalysisLine } from "./engine";
import { classify, cpEquivalent } from "./engineAnalysis";
import { getClassColor } from "./classificationColors";

export interface Candidate {
  rank: number; // 1 = the engine's top choice
  uci: string;
  san: string;
  from: Square;
  to: Square;
  scoreCp: number; // the mover's own view; a mate is a very large number
  mate?: number; // mover-relative moves to mate, when the line is a mate
  gapCp: number; // how far short of the best candidate this one falls
  tier: string; // best / excellent / good / inaccuracy / mistake / blunder
}

/** Lines are the engine's own, mover-relative. A line whose first move
 * doesn't parse against `fen` is dropped rather than guessed at. */
export function buildCandidates(fen: string, lines: AnalysisLine[]): Candidate[] {
  const scored: Omit<Candidate, "rank" | "gapCp" | "tier">[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const uci = line.pv[0];
    if (!uci || seen.has(uci)) continue;
    try {
      const board = new Chess(fen);
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      seen.add(uci);
      scored.push({
        uci,
        san: move.san,
        from: move.from,
        to: move.to,
        scoreCp: cpEquivalent(line.scoreCp, line.scoreMate),
        mate: line.scoreMate,
      });
    } catch {
      continue;
    }
  }
  scored.sort((a, b) => b.scoreCp - a.scoreCp);
  const bestScore = scored[0]?.scoreCp ?? 0;
  return scored.map((c, i) => {
    const gapCp = Math.max(0, bestScore - c.scoreCp);
    return { ...c, rank: i + 1, gapCp, tier: classify(gapCp) };
  });
}

/** "+0.3", "-1.2", "M3" -- the candidate's evaluation from the mover's side. */
export function formatCandidateEval(c: Candidate): string {
  if (c.mate !== undefined) return c.mate > 0 ? `M${c.mate}` : `-M${Math.abs(c.mate)}`;
  const pawns = c.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export interface OverlayTint {
  square: Square;
  color: string;
  opacity: number;
}

export interface OverlayArrow {
  from: Square;
  to: Square;
  color: string;
  kind: "best" | "played" | "preview";
}

export interface CandidateOverlay {
  tints: OverlayTint[];
  arrows: OverlayArrow[];
}

// Only moves that are still good get shaded: the point is "where can I
// go", not a map of every legal move.
const SHADED_TIERS: Record<string, number> = { best: 0.62, excellent: 0.5, good: 0.38 };

export function isShadedTier(tier: string): boolean {
  return tier in SHADED_TIERS;
}

/** What to draw for one position. `playedUci` is the move actually played
 * (drawn in its own tier's color so the gap to the best move is visible);
 * `previewUci` is a candidate the viewer tapped in the list. Colors come
 * from getClassColor, so the colour-blind toggle applies. */
export function buildOverlay(
  candidates: Candidate[],
  playedUci: string | undefined,
  playedTier: string | undefined,
  previewUci?: string | null,
): CandidateOverlay {
  const tints: OverlayTint[] = [];
  const tinted = new Set<string>();
  for (const c of candidates) {
    if (!isShadedTier(c.tier) || tinted.has(c.to)) continue; // best-ranked candidate wins a shared destination
    tinted.add(c.to);
    tints.push({ square: c.to, color: getClassColor(c.tier), opacity: SHADED_TIERS[c.tier] });
  }

  const arrows: OverlayArrow[] = [];
  const best = candidates[0];
  if (best) arrows.push({ from: best.from, to: best.to, color: getClassColor("best"), kind: "best" });
  if (playedUci && playedUci !== best?.uci) {
    arrows.push({
      from: playedUci.slice(0, 2) as Square,
      to: playedUci.slice(2, 4) as Square,
      color: getClassColor(playedTier ?? "inaccuracy"),
      kind: "played",
    });
  }
  const preview = previewUci ? candidates.find((c) => c.uci === previewUci) : undefined;
  if (preview && preview.uci !== best?.uci && preview.uci !== playedUci) {
    arrows.push({ from: preview.from, to: preview.to, color: getClassColor(preview.tier), kind: "preview" });
  }
  return { tints, arrows };
}

/** Arrows available before the engine has answered: the stored best move
 * and the played move, straight from the grading record. */
export function quickArrows(
  bestUci: string | undefined,
  playedUci: string,
  playedTier: string | undefined,
): OverlayArrow[] {
  const arrows: OverlayArrow[] = [];
  if (bestUci) {
    arrows.push({
      from: bestUci.slice(0, 2) as Square,
      to: bestUci.slice(2, 4) as Square,
      color: getClassColor("best"),
      kind: "best",
    });
  }
  if (playedUci !== bestUci) {
    arrows.push({
      from: playedUci.slice(0, 2) as Square,
      to: playedUci.slice(2, 4) as Square,
      color: getClassColor(playedTier ?? "inaccuracy"),
      kind: "played",
    });
  }
  return arrows;
}
