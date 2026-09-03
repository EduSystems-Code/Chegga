import { describe, it, expect } from "vitest";
import { computeBlunderRate } from "../../src/blunderRate";
import { game, move } from "./_factories";

// endTime is unix SECONDS; these two land in different calendar months.
const JAN_2024 = Math.floor(Date.UTC(2024, 0, 15) / 1000);
const FEB_2024 = Math.floor(Date.UTC(2024, 1, 15) / 1000);

describe("computeBlunderRate", () => {
  it("returns undefined with no analyzed moves", () => {
    expect(computeBlunderRate([], [])).toBeUndefined();
  });

  it("computes blunders per 100 of the player's own moves", () => {
    const g = game({ chessComUuid: "g1", endTime: JAN_2024 });
    const moves = [
      ...Array.from({ length: 97 }, () => move({ gameId: "g1", classification: "good" })),
      ...Array.from({ length: 3 }, () => move({ gameId: "g1", classification: "blunder" })),
    ];
    const summary = computeBlunderRate([g], moves)!;
    expect(summary.totalMoves).toBe(100);
    expect(summary.blundersPer100).toBe(3);
  });

  it("counts a tagged one-move oversight even when it is only a 'mistake'", () => {
    const g = game({ chessComUuid: "g1", endTime: JAN_2024 });
    const moves = [
      move({ gameId: "g1", classification: "mistake", blunderTag: "hung_material" }),
      move({ gameId: "g1", classification: "blunder", blunderTag: "positional" }),
      ...Array.from({ length: 8 }, () => move({ gameId: "g1", classification: "good" })),
    ];
    const summary = computeBlunderRate([g], moves)!;
    // 1 blunder / 10 moves, but 1 oversight (the tagged mistake) + the
    // blunder is not an oversight tag -> oversights = 1
    expect(summary.blundersPer100).toBe(10);
    expect(summary.oversightsPer100).toBe(10);
  });

  it("drops thin months (<20 own-moves) from the monthly series but keeps them in the totals", () => {
    const jan = game({ chessComUuid: "jan", endTime: JAN_2024 });
    const feb = game({ chessComUuid: "feb", endTime: FEB_2024 });
    const janMoves = Array.from({ length: 40 }, () => move({ gameId: "jan", classification: "good" }));
    const febMoves = Array.from({ length: 5 }, () => move({ gameId: "feb", classification: "good" }));
    const summary = computeBlunderRate([jan, feb], [...janMoves, ...febMoves])!;
    expect(summary.totalMoves).toBe(45);
    expect(summary.monthly.map((m) => m.month)).toEqual(["2024-01"]);
  });

  it("reports an improving trend as a negative delta", () => {
    const jan = game({ chessComUuid: "jan", endTime: JAN_2024 });
    const feb = game({ chessComUuid: "feb", endTime: FEB_2024 });
    const janMoves = [
      ...Array.from({ length: 20 }, () => move({ gameId: "jan", classification: "blunder" })),
      ...Array.from({ length: 20 }, () => move({ gameId: "jan", classification: "good" })),
    ]; // 50 per 100
    const febMoves = [
      ...Array.from({ length: 4 }, () => move({ gameId: "feb", classification: "blunder" })),
      ...Array.from({ length: 36 }, () => move({ gameId: "feb", classification: "good" })),
    ]; // 10 per 100
    const summary = computeBlunderRate([jan, feb], [...janMoves, ...febMoves])!;
    expect(summary.trend).toBe(-40);
  });
});
