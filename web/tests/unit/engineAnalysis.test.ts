import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { analyzeGame, classify, MATE_SCORE_CP } from "../../src/engineAnalysis";
import type { Engine } from "../../src/engine";
import { game } from "./_factories";

// A stand-in engine: analyzeGame only ever calls `analyse`, so a fixed
// reply is enough to exercise the replay/joining logic without Stockfish.
// The fixed pv is White's 1. e4, legal in every position used below.
//
// The one behavior it copies faithfully from the real thing: a position
// with no legal moves gets NO line back, because there is nothing for the
// engine to search. That absence is what the checkmate grading depends on.
function fakeEngine(scoreCp = 20): Engine {
  return {
    analyse: async (fen: string) => {
      if (new Chess(fen).moves().length === 0) return [];
      return [{ multipv: 1, depth: 14, scoreCp, pv: ["e2e4"] }];
    },
  } as unknown as Engine;
}

const STANDARD_PGN = `[Event "Test"]\n[TimeControl "600"]\n\n1. e4 e5 2. Nf3`;

// White is missing the e2 pawn, so 1. Qe2 is legal here and illegal from
// the standard start — exactly the case a handicap bot game produces.
const ODDS_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1";
const ODDS_PGN = `[Event "Test"]\n[TimeControl "600"]\n[SetUp "1"]\n[FEN "${ODDS_FEN}"]\n\n1. Qe2 e5`;

describe("analyzeGame", () => {
  it("grades every half-move of a normal game", async () => {
    const moves = await analyzeGame(fakeEngine(), game({ pgn: STANDARD_PGN }));
    expect(moves.map((m) => m.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(moves.map((m) => m.sideToMove)).toEqual(["white", "black", "white"]);
    expect(moves[0].fenBefore).toContain("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w");
  });

  it("replays a game from the start position its PGN carries", async () => {
    // Before the fix this threw: the replay always began from the standard
    // start, where this game's first move isn't legal.
    const moves = await analyzeGame(fakeEngine(), game({ pgn: ODDS_PGN }));
    expect(moves.map((m) => m.san)).toEqual(["Qe2", "e5"]);
    expect(moves[0].fenBefore).toBe(ODDS_FEN);
  });

  it("grades a checkmating move as the best move, not a blunder", async () => {
    // Fool's mate: Black's 2... Qh4# ends the game. The mated position has
    // no legal moves and so no engine line; before the fix that absence
    // scored as "eval 0" and the mate came out as a 1000cp blunder.
    const moves = await analyzeGame(fakeEngine(), game({ pgn: `[TimeControl "600"]\n\n1. f3 e5 2. g4 Qh4#` }));
    const mate = moves[moves.length - 1];
    expect(mate.san).toBe("Qh4#");
    expect(mate.centipawnLoss).toBe(0);
    expect(mate.classification).toBe("best");
    // Black delivered it, so the white-relative eval is Black winning.
    expect(mate.evalAfterCp).toBe(-MATE_SCORE_CP);
  });

  it("stores evals White-relative, whichever side the engine scored for", async () => {
    // UCI reports a score from the side-to-move's own perspective; the
    // stored fields keep the backend's White-relative convention. With the
    // fake engine answering +20 for every position, that flips sign by ply.
    const moves = await analyzeGame(fakeEngine(20), game({ pgn: STANDARD_PGN }));
    expect(moves[0].evalBeforeCp).toBe(20); // White to move
    expect(moves[1].evalBeforeCp).toBe(-20); // Black to move
  });

  it("tags each move with the game phase", async () => {
    const moves = await analyzeGame(fakeEngine(), game({ pgn: STANDARD_PGN }));
    expect(moves.every((m) => m.gamePhase === "opening")).toBe(true);
  });
});

describe("classify", () => {
  it("uses this project's own centipawn-loss thresholds", () => {
    expect(classify(0)).toBe("best");
    expect(classify(10)).toBe("best");
    expect(classify(25)).toBe("excellent");
    expect(classify(50)).toBe("good");
    expect(classify(100)).toBe("inaccuracy");
    expect(classify(200)).toBe("mistake");
    expect(classify(201)).toBe("blunder");
  });
});
