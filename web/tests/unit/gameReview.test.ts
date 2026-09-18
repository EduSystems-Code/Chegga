import { describe, it, expect } from "vitest";
import {
  buildReview,
  describeStep,
  moveLabel,
  shouldShowBetterMove,
  tallyHumanQuality,
  worstHumanStepIndex,
} from "../../src/gameReview";
import { move } from "./_factories";

// 1. e4 e5 2. Nf3 Nc6 3. Bb5 — five half-moves, three of them White's.
const PGN = `[Event "Test"]\n[TimeControl "0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5`;

// A handicap / "from position" game: chess.js writes FEN + SetUp headers
// when a game doesn't start from the standard setup.
const ODDS_PGN = `[Event "Test"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1"]\n\n1. e4 e5`;

const GRADES = [
  move({ ply: 1, san: "e4", sideToMove: "white", classification: "best", centipawnLoss: 0 }),
  move({ ply: 2, san: "e5", sideToMove: "black", classification: "good", centipawnLoss: 30 }),
  move({
    ply: 3,
    san: "Nf3",
    sideToMove: "white",
    classification: "mistake",
    centipawnLoss: 160,
    bestMoveSan: "Nc3",
    bestMoveUci: "b1c3",
  }),
  move({ ply: 4, san: "Nc6", sideToMove: "black", classification: "blunder", centipawnLoss: 400 }),
  move({ ply: 5, san: "Bb5", sideToMove: "white", classification: "excellent", centipawnLoss: 20 }),
];

describe("buildReview", () => {
  it("makes one step per half-move, in order", () => {
    const review = buildReview(PGN, GRADES, "white");
    expect(review.steps.map((s) => s.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(review.steps.map((s) => s.ply)).toEqual([1, 2, 3, 4, 5]);
    expect(review.steps.map((s) => s.moveNumber)).toEqual([1, 1, 2, 2, 3]);
  });

  it("marks the reviewer's own moves and no others", () => {
    expect(buildReview(PGN, GRADES, "white").steps.map((s) => s.isHuman)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(buildReview(PGN, GRADES, "black").steps.map((s) => s.isHuman)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("carries the position each move produces, plus its from/to squares", () => {
    const [first] = buildReview(PGN, GRADES, "white").steps;
    expect(first.from).toBe("e2");
    expect(first.to).toBe("e4");
    expect(first.fenAfter).toContain("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b");
  });

  it("joins each move to its grade by ply", () => {
    const review = buildReview(PGN, GRADES, "white");
    expect(review.steps[2].classification).toBe("mistake");
    expect(review.steps[2].centipawnLoss).toBe(160);
    expect(review.steps[2].bestMoveSan).toBe("Nc3");
  });

  it("leaves steps ungraded when analysis doesn't cover them", () => {
    const review = buildReview(PGN, GRADES.slice(0, 2), "white");
    expect(review.steps[0].classification).toBe("best");
    expect(review.steps[4].classification).toBeUndefined();
  });

  it("ignores a record whose ply matches but whose move doesn't", () => {
    const wrongGame = [move({ ply: 1, san: "d4", classification: "blunder", centipawnLoss: 500 })];
    const review = buildReview(PGN, wrongGame, "white");
    expect(review.steps[0].classification).toBeUndefined();
  });

  it("keeps the game's own start position when it isn't the standard one", () => {
    const review = buildReview(ODDS_PGN, [], "white");
    expect(review.startFen).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1");
    expect(review.steps).toHaveLength(2);
  });

  it("defaults the start to the standard position for a normal game", () => {
    expect(buildReview(PGN, GRADES, "white").startFen).toContain(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
    );
  });
});

describe("tallyHumanQuality", () => {
  it("counts only the reviewer's own moves, in tier order", () => {
    expect(tallyHumanQuality(buildReview(PGN, GRADES, "white"))).toEqual([
      { classification: "best", count: 1 },
      { classification: "excellent", count: 1 },
      { classification: "mistake", count: 1 },
    ]);
  });

  it("counts the other side's moves when reviewing as Black", () => {
    expect(tallyHumanQuality(buildReview(PGN, GRADES, "black"))).toEqual([
      { classification: "good", count: 1 },
      { classification: "blunder", count: 1 },
    ]);
  });

  it("is empty when nothing is graded", () => {
    expect(tallyHumanQuality(buildReview(PGN, [], "white"))).toEqual([]);
  });
});

describe("worstHumanStepIndex", () => {
  it("finds the reviewer's costliest move", () => {
    // White's Nf3 (160cp) — not Black's 400cp blunder.
    expect(worstHumanStepIndex(buildReview(PGN, GRADES, "white"))).toBe(2);
    expect(worstHumanStepIndex(buildReview(PGN, GRADES, "black"))).toBe(3);
  });

  it("returns -1 when there is nothing to jump to", () => {
    expect(worstHumanStepIndex(buildReview(PGN, [], "white"))).toBe(-1);
    const flawless = [move({ ply: 1, san: "e4", classification: "best", centipawnLoss: 0 })];
    expect(worstHumanStepIndex(buildReview(PGN, flawless, "white"))).toBe(-1);
  });
});

describe("shouldShowBetterMove", () => {
  const review = buildReview(PGN, GRADES, "white");

  it("names the engine's move only for moves that actually lost something", () => {
    expect(shouldShowBetterMove(review.steps[2])).toBe(true); // mistake, with a better move
    expect(shouldShowBetterMove(review.steps[0])).toBe(false); // best — nothing better to show
    expect(shouldShowBetterMove(review.steps[4])).toBe(false); // excellent
  });

  it("stays quiet when the played move already was the engine's move", () => {
    const [step] = buildReview(PGN, [
      move({ ply: 1, san: "e4", classification: "mistake", centipawnLoss: 120, bestMoveSan: "e4" }),
    ]).steps;
    expect(shouldShowBetterMove(step)).toBe(false);
  });
});

describe("move labels and captions", () => {
  const review = buildReview(PGN, GRADES, "white");

  it("labels moves the way a move list does", () => {
    expect(moveLabel(review.steps[0])).toBe("1. e4");
    expect(moveLabel(review.steps[1])).toBe("1... e5");
    expect(moveLabel(review.steps[4])).toBe("3. Bb5");
  });

  it("describes the starting position", () => {
    expect(describeStep(review, -1)).toContain("Starting position");
  });

  it("names the tier and the loss for the reviewer's own move", () => {
    expect(describeStep(review, 2)).toBe("2. Nf3 — Mistake, 160cp lost. Engine preferred Nc3.");
  });

  it("drops the loss when a move gave nothing away", () => {
    expect(describeStep(review, 0)).toBe("1. e4 — Best!");
  });

  it("never quotes centipawns for a best move", () => {
    const nearBest = buildReview(
      PGN,
      [move({ ply: 1, san: "e4", classification: "best", centipawnLoss: 7 })],
      "white",
    );
    expect(describeStep(nearBest, 0)).toBe("1. e4 — Best!");
  });

  it("punctuates a tier whose label isn't already punctuated", () => {
    const partial = buildReview(PGN, [move({ ply: 1, san: "e4", classification: "good", centipawnLoss: 0 })], "white");
    expect(describeStep(partial, 0)).toBe("1. e4 — Good.");
  });

  it("does not grade the opponent's move", () => {
    expect(describeStep(review, 1)).toBe("1... e5 — your opponent's move.");
  });

  it("says so when a move wasn't graded", () => {
    const partial = buildReview(PGN, GRADES.slice(0, 2), "white");
    expect(describeStep(partial, 4)).toBe("3. Bb5 — your move (not graded).");
  });
});
