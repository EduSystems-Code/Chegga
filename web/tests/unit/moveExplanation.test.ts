import { describe, it, expect } from "vitest";
import { explainMove, explainInputFromStep, type ExplainInput } from "../../src/moveExplanation";
import { buildReview } from "../../src/gameReview";
import { move } from "./_factories";

// After 1.e4 d5 -- White's e4 pawn is attacked and undefended, Black's
// light-squared bishop looks down the c8-h3 diagonal.
const AFTER_E4_D5 = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
// After 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 -- Qxf7 is checkmate.
const MATE_IN_ONE = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// After 1.e4 e5 2.f4 d5 -- Bb5 gives check down the open d7-e8 diagonal.
const BISHOP_CHECK = "rnbqkbnr/ppp2ppp/8/3pp3/4PP2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

function input(over: Partial<ExplainInput>): ExplainInput {
  return {
    fenBefore: AFTER_E4_D5,
    san: "Nf3",
    uci: "g1f3",
    side: "white",
    classification: "mistake",
    centipawnLoss: 160,
    ...over,
  };
}

describe("explainMove", () => {
  it("says nothing for a move that wasn't graded", () => {
    expect(explainMove(input({ classification: undefined }))).toEqual([]);
  });

  it("confirms a best move in one line", () => {
    expect(explainMove(input({ classification: "best", centipawnLoss: 0 }))).toEqual([
      "This was the engine's top choice.",
    ]);
  });

  it("names the better move for a close alternative", () => {
    const [line] = explainMove(input({ classification: "good", centipawnLoss: 35, bestMoveSan: "exd5" }));
    expect(line).toContain("exd5");
    expect(line).toContain("35cp");
  });

  it("names a forced mate that was missed", () => {
    const [line] = explainMove(
      input({
        fenBefore: MATE_IN_ONE,
        san: "Nc3",
        uci: "b1c3",
        classification: "blunder",
        blunderTag: "missed_mate",
        bestMoveSan: "Qxf7#",
        bestMoveUci: "h5f7",
      }),
    );
    expect(line).toBe("You had a forced mate here. Qxf7# starts it.");
  });

  it("says which piece a move left hanging, and where", () => {
    const lines = explainMove(
      input({
        san: "Qg4",
        uci: "d1g4",
        classification: "blunder",
        centipawnLoss: 620,
        blunderTag: "hung_material",
        bestMoveSan: "exd5",
        bestMoveUci: "e4d5",
      }),
    );
    expect(lines[0]).toBe("Qg4 leaves your queen on g4 open to capture.");
    expect(lines).toContain("exd5 was better.");
  });

  it("says what a passed-up capture would have taken", () => {
    const [line] = explainMove(input({ blunderTag: "missed_capture", bestMoveSan: "exd5", bestMoveUci: "e4d5" }));
    expect(line).toBe("exd5 captures the pawn on d5. You passed it up.");
  });

  it("says a better move gives check", () => {
    const [line] = explainMove(
      input({ fenBefore: BISHOP_CHECK, classification: "inaccuracy", bestMoveSan: "Bb5+", bestMoveUci: "f1b5" }),
    );
    expect(line).toBe("Bb5+ was stronger: it gives check.");
  });

  it("says a better move develops a piece, in the opening only", () => {
    const base = {
      fenBefore: AFTER_E4_E5,
      san: "h3",
      uci: "h2h3",
      classification: "inaccuracy",
      bestMoveSan: "Nf3",
      bestMoveUci: "g1f3",
    };
    const opening = explainMove(input({ ...base, gamePhase: "opening" }));
    expect(opening[0]).toBe("Nf3 was stronger: it develops your knight.");
    const middlegame = explainMove(input({ ...base, gamePhase: "middlegame" }));
    expect(middlegame[0]).toBe("Nf3 was stronger.");
  });

  it("falls back to the pawn cost when there is no evaluation to quote", () => {
    const lines = explainMove(input({ bestMoveSan: "exd5", bestMoveUci: "e4d5", centipawnLoss: 160 }));
    expect(lines.at(-1)).toBe("Compared with the engine's move, this gave up about 1.6 pawns.");
  });

  it("quotes the evaluation swing from the mover's own side", () => {
    const white = explainMove(input({ bestMoveSan: "exd5", evalBeforeCp: 150, evalAfterCp: -40 }));
    expect(white.at(-1)).toBe("The engine's evaluation for you went from +1.5 to -0.4.");
    // The stored numbers are White-relative, so Black sees the mirror image.
    const black = explainMove(input({ side: "black", bestMoveSan: "exd5", evalBeforeCp: -150, evalAfterCp: 40 }));
    expect(black.at(-1)).toBe("The engine's evaluation for you went from +1.5 to -0.4.");
  });

  it("describes a lost forced win in mate terms", () => {
    const lines = explainMove(
      input({ blunderTag: "allowed_mate", bestMoveSan: "exd5", evalBeforeCp: 80, evalAfterMate: -2 }),
    );
    expect(lines[0]).toContain("allows a forced mate against you");
    expect(lines.at(-1)).toContain("mate against you in 2");
  });

  it("does not throw on a position that doesn't match the move", () => {
    expect(() =>
      explainMove(input({ fenBefore: "8/8/8/8/8/8/8/K6k w - - 0 1", bestMoveSan: "Qd5", bestMoveUci: "d1d5" })),
    ).not.toThrow();
  });

  it("builds its input from a review step", () => {
    const pgn = `[Event "t"]\n\n1. e4 d5 2. Nf3`;
    const review = buildReview(
      pgn,
      [
        move({
          ply: 3,
          san: "Nf3",
          uci: "g1f3",
          classification: "mistake",
          centipawnLoss: 130,
          bestMoveSan: "exd5",
          bestMoveUci: "e4d5",
        }),
      ],
      "white",
    );
    const step = review.steps[2];
    expect(explainInputFromStep(step).fenBefore).toBe(AFTER_E4_D5);
    expect(explainMove(explainInputFromStep(step))[0]).toBe("exd5 was stronger: it captures the pawn on d5.");
  });
});
