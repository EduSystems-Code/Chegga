import { describe, it, expect } from "vitest";
import { weakestOpening, worstPositionInOpening } from "../../src/statsInsights";
import { game, move } from "./_factories";

describe("worstPositionInOpening", () => {
  it("finds the costliest opening-phase move among games in that exact line", () => {
    const games = [
      game({ chessComUuid: "g1", openingName: "French Defense" }),
      game({ chessComUuid: "g2", openingName: "French Defense" }),
      game({ chessComUuid: "g3", openingName: "Sicilian Defense" }),
    ];
    const moves = [
      move({ gameId: "g1", ply: 3, gamePhase: "opening", centipawnLoss: 40 }),
      move({ gameId: "g1", ply: 9, gamePhase: "middlegame", centipawnLoss: 500 }), // bigger loss, but not an opening move -- must be ignored
      move({ gameId: "g2", ply: 5, gamePhase: "opening", centipawnLoss: 220 }), // the real worst
      move({ gameId: "g3", ply: 3, gamePhase: "opening", centipawnLoss: 900 }), // different opening -- must be ignored
    ];

    const worst = worstPositionInOpening(games, moves, "French Defense");
    expect(worst).toEqual({ gameId: "g2", ply: 5, centipawnLoss: 220 });
  });

  it("returns undefined when the opening has no games", () => {
    expect(worstPositionInOpening([game({ openingName: "Sicilian Defense" })], [], "French Defense")).toBeUndefined();
  });

  it("returns undefined when every opening-phase move in the line already scored 0 loss", () => {
    const games = [game({ chessComUuid: "g1", openingName: "French Defense" })];
    const moves = [move({ gameId: "g1", ply: 1, gamePhase: "opening", centipawnLoss: 0 })];
    expect(worstPositionInOpening(games, moves, "French Defense")).toBeUndefined();
  });
});

describe("weakestOpening", () => {
  it("names the opening with the worst average centipawn loss, needing at least minGames", () => {
    const games = [
      game({ chessComUuid: "g1", openingName: "French Defense", userResult: "loss" }),
      game({ chessComUuid: "g2", openingName: "French Defense", userResult: "win" }),
      game({ chessComUuid: "g3", openingName: "Italian Game", userResult: "win" }),
    ];
    const moves = [
      move({ gameId: "g1", centipawnLoss: 80 }),
      move({ gameId: "g2", centipawnLoss: 60 }),
      move({ gameId: "g3", centipawnLoss: 5 }),
    ];
    const worst = weakestOpening(games, moves);
    expect(worst?.openingName).toBe("French Defense");
    expect(worst?.games).toBe(2);
  });

  it("skips a single-game opening as too noisy a sample", () => {
    const games = [game({ chessComUuid: "g1", openingName: "Sicilian Defense" })];
    const moves = [move({ gameId: "g1", centipawnLoss: 900 })];
    expect(weakestOpening(games, moves)).toBeUndefined();
  });
});
