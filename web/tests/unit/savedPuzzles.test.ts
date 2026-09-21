import { describe, it, expect } from "vitest";
import { puzzleFromStep, puzzleIdFor, describeSavedPuzzle } from "../../src/savedPuzzles";
import {
  buildReview,
  keyMoments,
  canPracticeStep,
  betterMoveArrowFitsAfterBoard,
  describeBefore,
} from "../../src/gameReview";
import { move } from "./_factories";

const PGN = `[Event "t"]\n\n1. e4 d5 2. Nf3 Nc6 3. Bb5 e5`;

const GRADES = [
  move({ ply: 1, san: "e4", uci: "e2e4", classification: "best", centipawnLoss: 0, bestMoveSan: "e4", bestMoveUci: "e2e4" }),
  move({
    ply: 3,
    san: "Nf3",
    uci: "g1f3",
    classification: "mistake",
    centipawnLoss: 160,
    bestMoveSan: "exd5",
    bestMoveUci: "e4d5",
    blunderTag: "missed_capture",
    gamePhase: "opening",
  }),
  move({
    ply: 5,
    san: "Bb5",
    uci: "f1b5",
    classification: "blunder",
    centipawnLoss: 420,
    bestMoveSan: "d4",
    bestMoveUci: "d2d4",
    blunderTag: "positional",
    gamePhase: "opening",
  }),
  move({ ply: 6, san: "e5", uci: "e7e5", classification: "blunder", centipawnLoss: 900, bestMoveSan: "Nf6", bestMoveUci: "g8f6" }),
];

const AFTER_E4_D5_FEN = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

describe("a review step carries the position it was chosen in", () => {
  const review = buildReview(PGN, GRADES, "white", "g-1");

  it("keeps the fen before, the uci, and the extra grade fields", () => {
    const step = review.steps[2]; // 2. Nf3
    expect(step.uci).toBe("g1f3");
    expect(step.fenBefore).toBe(AFTER_E4_D5_FEN);
    expect(step.blunderTag).toBe("missed_capture");
    expect(step.gamePhase).toBe("opening");
  });

  it("remembers the game id", () => {
    expect(review.gameId).toBe("g-1");
    expect(buildReview(PGN, GRADES, "white").gameId).toBeUndefined();
  });
});

describe("canPracticeStep / keyMoments", () => {
  const review = buildReview(PGN, GRADES, "white", "g-1");

  it("only offers the reviewer's own moves that lost something", () => {
    expect(canPracticeStep(review.steps[0])).toBe(false); // best
    expect(canPracticeStep(review.steps[2])).toBe(true); // own mistake
    expect(canPracticeStep(review.steps[5])).toBe(false); // the opponent's blunder
  });

  it("lists the costliest own mistakes first", () => {
    expect(keyMoments(review).map((s) => s.san)).toEqual(["Bb5", "Nf3"]);
    expect(keyMoments(review, 1).map((s) => s.san)).toEqual(["Bb5"]);
  });
});

describe("betterMoveArrowFitsAfterBoard", () => {
  const review = buildReview(PGN, GRADES, "white");

  it("draws when the better move starts on an untouched square", () => {
    expect(betterMoveArrowFitsAfterBoard(review.steps[2])).toBe(true); // exd5's e4, played g1f3
  });

  it("skips when the better move starts where the played piece just left", () => {
    expect(betterMoveArrowFitsAfterBoard({ ...review.steps[2], bestMoveUci: "g1e2" })).toBe(false);
  });

  it("skips when the better move starts on the square the played piece landed on", () => {
    expect(betterMoveArrowFitsAfterBoard({ ...review.steps[2], bestMoveUci: "f3e5" })).toBe(false);
  });
});

describe("describeBefore", () => {
  const review = buildReview(PGN, GRADES, "white");

  it("names the played move, its tier, and the engine's choice", () => {
    expect(describeBefore(review, 2)).toBe(
      "Position before 2. Nf3 — you played Nf3 (Mistake). The engine's top choice was exd5.",
    );
  });

  it("notes when the played move was the engine's move", () => {
    expect(describeBefore(review, 0)).toBe(
      "Position before 1. e4 — you played e4 (Best!). That was also the engine's top choice.",
    );
  });
});

describe("puzzleFromStep", () => {
  const synced = buildReview(PGN, GRADES, "white", "g-1");
  const bot = buildReview(PGN, GRADES, "white");

  it("builds a puzzle from a mistake, keyed like an auto-extracted one", () => {
    const p = puzzleFromStep(synced, synced.steps[2], "Scandinavian Defense")!;
    expect(p.id).toBe("g-1:3");
    expect(p).toMatchObject({
      gameId: "g-1",
      ply: 3,
      sideToMove: "white",
      playedSan: "Nf3",
      bestMoveUci: "e4d5",
      bestMoveSan: "exd5",
      classification: "mistake",
      difficulty: "medium",
      gamePhase: "opening",
      blunderTag: "missed_capture",
      openingName: "Scandinavian Defense",
    });
  });

  it("keys a bot-game position by the position and the move", () => {
    expect(puzzleIdFor(bot, bot.steps[2])).toBe("bot:rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -:g1f3");
    expect(puzzleFromStep(bot, bot.steps[2])!.gameId).toBe("bot");
  });

  it("refuses a move that wasn't a mistake, or wasn't the reviewer's", () => {
    expect(puzzleFromStep(synced, synced.steps[0])).toBeNull();
    expect(puzzleFromStep(synced, synced.steps[5])).toBeNull();
  });

  it("summarizes a saved puzzle for its card", () => {
    const p = puzzleFromStep(synced, synced.steps[2])!;
    expect(describeSavedPuzzle(p)).toBe("Opening · lost 1.6 pawns with Nf3");
  });
});
