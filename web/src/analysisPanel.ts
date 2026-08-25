// Chegga Web — live analysis while playing (eval bar + best-move arrow +
// top candidate lines)
//
// Deliberately its own Engine instance, separate from botEngine.ts's —
// the bot's engine gets its UCI_LimitStrength/Elo toggled per move
// (botEngine.ts's whole point), and running analysis through that same
// instance would mean either fighting over that state or analyzing at
// artificially reduced strength. Two WASM workers costs a bit more
// memory; it buys real isolation instead of a shared-state bug.

import { Engine, type AnalysisLine } from "./engine";
import { Chess, type Square } from "chess.js";

let analysisEngine: Engine | null = null;

/** Exposed so other full-strength, non-bot uses (postGameReport.ts's
 * "analyze the bot game I just finished") share this same always-full-
 * strength engine instead of risking reuse of botEngine.ts's instance,
 * which may still have UCI_LimitStrength left on from the last move. */
export async function getAnalysisEngine(): Promise<Engine> {
  return getEngine();
}

async function getEngine(): Promise<Engine> {
  if (!analysisEngine) {
    analysisEngine = new Engine();
    await analysisEngine.init();
  }
  return analysisEngine;
}

export interface AnalysisResult {
  lines: AnalysisLine[]; // sorted by multipv, best first
  whiteRelativeCp?: number; // undefined when the top line is a mate score
  whiteRelativeMate?: number;
  sideToMove: "white" | "black";
}

export async function analyzePosition(fen: string, sideToMove: "white" | "black"): Promise<AnalysisResult> {
  const engine = await getEngine();
  // Full strength, no UCI_LimitStrength -- this is "what's actually best
  // here," not "what would a 900-rated bot play."
  const lines = await engine.analyse(fen, { depth: 14, multipv: 3, movetimeMs: 400 });
  const best = lines[0];

  const toWhiteRelative = (line?: AnalysisLine) => {
    if (!line) return { cp: undefined, mate: undefined };
    const sign = sideToMove === "white" ? 1 : -1;
    return {
      cp: line.scoreCp !== undefined ? line.scoreCp * sign : undefined,
      mate: line.scoreMate !== undefined ? line.scoreMate * sign : undefined,
    };
  };
  const { cp, mate } = toWhiteRelative(best);

  return { lines, whiteRelativeCp: cp, whiteRelativeMate: mate, sideToMove };
}

/** Win-probability-style bar height, the standard eval-bar convention:
 * a sigmoid of the centipawn score, not a linear scale (so a +200
 * advantage looks meaningfully bigger than +50, but +900 doesn't blow
 * off the top of the bar the way a linear scale would). */
export function evalBarWhiteFraction(cp: number | undefined, mate: number | undefined): number {
  if (mate !== undefined) return mate > 0 ? 1 : 0;
  if (cp === undefined) return 0.5;
  return 1 / (1 + Math.pow(10, -cp / 400));
}

export function formatEval(cp: number | undefined, mate: number | undefined): string {
  if (mate !== undefined) return `M${Math.abs(mate)}`;
  if (cp === undefined) return "—";
  const pawns = cp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export function bestMoveSquares(result: AnalysisResult): { from: Square; to: Square } | undefined {
  const uci = result.lines[0]?.pv[0];
  if (!uci) return undefined;
  return { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square };
}

export interface DescribedLine {
  san: string;
  cp?: number;
  mate?: number;
}

/** Converts each candidate line's first move to SAN against the real
 * position (a UCI string alone isn't readable) -- a line whose move
 * doesn't parse against `fen` (shouldn't happen, but a stale/mismatched
 * position is cheap to guard) is silently dropped rather than throwing. */
export function describeLines(fen: string, result: AnalysisResult): DescribedLine[] {
  const described: DescribedLine[] = [];
  for (const line of result.lines) {
    const uci = line.pv[0];
    if (!uci) continue;
    try {
      const board = new Chess(fen);
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      const sign = result.sideToMove === "white" ? 1 : -1;
      described.push({
        san: move.san,
        cp: line.scoreCp !== undefined ? line.scoreCp * sign : undefined,
        mate: line.scoreMate !== undefined ? line.scoreMate * sign : undefined,
      });
    } catch {
      continue;
    }
  }
  return described;
}

export function terminateAnalysisEngine(): void {
  analysisEngine?.terminate();
  analysisEngine = null;
}
