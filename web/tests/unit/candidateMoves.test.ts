import { describe, it, expect } from "vitest";
import { buildCandidates, buildOverlay, formatCandidateEval, quickArrows } from "../../src/candidateMoves";
import type { AnalysisLine } from "../../src/engine";
import { CLASS_COLOR } from "../../src/classificationColors";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function line(multipv: number, scoreCp: number | undefined, pv: string, scoreMate?: number): AnalysisLine {
  return { multipv, depth: 12, scoreCp, scoreMate, pv: [pv] };
}

const LINES = [line(1, 30, "e2e4"), line(2, 22, "d2d4"), line(3, -20, "g1f3"), line(4, -90, "a2a3")];

describe("buildCandidates", () => {
  it("ranks by score and tiers each move by its gap to the best", () => {
    const c = buildCandidates(START, LINES);
    expect(c.map((x) => x.san)).toEqual(["e4", "d4", "Nf3", "a3"]);
    expect(c.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    expect(c.map((x) => x.gapCp)).toEqual([0, 8, 50, 120]);
    expect(c.map((x) => x.tier)).toEqual(["best", "best", "good", "mistake"]);
  });

  it("puts a mate ahead of any centipawn score", () => {
    const c = buildCandidates(START, [line(1, 250, "e2e4"), line(2, undefined, "d2d4", 3)]);
    expect(c[0].uci).toBe("d2d4");
    expect(formatCandidateEval(c[0])).toBe("M3");
    expect(c[1].tier).toBe("blunder"); // +2.5 is a long way short of a forced mate
  });

  it("drops a line whose move doesn't fit the position, and duplicates", () => {
    const c = buildCandidates(START, [line(1, 10, "e2e5"), line(2, 5, "e2e4"), line(3, 4, "e2e4")]);
    expect(c.map((x) => x.uci)).toEqual(["e2e4"]);
  });

  it("formats an evaluation from the mover's side", () => {
    const [c] = buildCandidates(START, [line(1, -135, "e2e4")]);
    expect(formatCandidateEval(c)).toBe("-1.4");
  });
});

describe("buildOverlay", () => {
  const candidates = buildCandidates(START, LINES);

  it("shades only the strong candidates, on their destination squares", () => {
    const { tints } = buildOverlay(candidates, undefined, undefined);
    expect(tints.map((t) => t.square)).toEqual(["e4", "d4", "f3"]); // best, best, good -- not the a3 mistake
    expect(tints[0].color).toBe(CLASS_COLOR.best);
    expect(tints[2].color).toBe(CLASS_COLOR.good);
  });

  it("draws the best move, and the played move in its own tier's color", () => {
    const { arrows } = buildOverlay(candidates, "a2a3", "mistake");
    expect(arrows.map((a) => a.kind)).toEqual(["best", "played"]);
    expect(arrows[0]).toMatchObject({ from: "e2", to: "e4" });
    expect(arrows[1]).toMatchObject({ from: "a2", to: "a3", color: CLASS_COLOR.mistake });
  });

  it("draws one arrow when the played move was the best move", () => {
    expect(buildOverlay(candidates, "e2e4", "best").arrows.map((a) => a.kind)).toEqual(["best"]);
  });

  it("adds a preview arrow for a tapped candidate", () => {
    const { arrows } = buildOverlay(candidates, "e2e4", "best", "g1f3");
    expect(arrows.map((a) => a.kind)).toEqual(["best", "preview"]);
    expect(arrows[1].color).toBe(CLASS_COLOR.good);
  });

  it("has nothing to draw with no candidates", () => {
    expect(buildOverlay([], undefined, undefined)).toEqual({ tints: [], arrows: [] });
  });
});

describe("quickArrows", () => {
  it("uses the stored best move before the engine answers", () => {
    expect(quickArrows("e2e4", "a2a3", "mistake").map((a) => a.kind)).toEqual(["best", "played"]);
    expect(quickArrows("e2e4", "e2e4", "best").map((a) => a.kind)).toEqual(["best"]);
    expect(quickArrows(undefined, "a2a3", "mistake").map((a) => a.kind)).toEqual(["played"]);
  });
});
