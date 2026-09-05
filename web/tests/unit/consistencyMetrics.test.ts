import { describe, it, expect } from "vitest";
import { computeConsistency } from "../../src/consistencyMetrics";
import { game } from "./_factories";

// Games 10 minutes apart so they all count as one session.
function session(results: Array<"win" | "loss" | "draw">, startSeconds = 1_700_000_000) {
  return results.map((userResult, i) =>
    game({
      chessComUuid: `c${i}`,
      endTime: startSeconds + i * 600,
      rated: true,
      userResult,
    }),
  );
}

describe("computeConsistency", () => {
  it("returns undefined below the 10-rated-game floor", () => {
    expect(computeConsistency(session(["win", "loss"]), [])).toBeUndefined();
  });

  it("computes the baseline win rate over rated games", () => {
    const games = session(["win", "win", "win", "win", "win", "loss", "loss", "loss", "loss", "loss"]);
    const c = computeConsistency(games, [])!;
    expect(c.baselineWinRate).toBeCloseTo(0.5, 5);
  });

  it("tracks the longest losing streak", () => {
    const games = session(["win", "loss", "loss", "loss", "loss", "win", "loss", "loss", "win", "win", "win", "win"]);
    const c = computeConsistency(games, [])!;
    expect(c.longestLossStreak).toBe(4);
  });

  it("scores the game-after-a-loss slot from real sequencing", () => {
    // loss,loss,loss,... => every game after game 1 follows a loss and is itself a loss
    const games = session(["loss", "loss", "loss", "loss", "loss", "loss", "loss", "loss", "loss", "loss", "loss", "win"]);
    const c = computeConsistency(games, [])!;
    expect(c.afterLoss.games).toBe(11); // games 2..12 each follow a loss
    expect(c.afterLoss.winRate).toBeCloseTo(1 / 11, 5); // only the last one is a win
  });

  it("always returns at least one recommendation line", () => {
    const games = session(Array.from({ length: 12 }, () => "win" as const));
    const c = computeConsistency(games, [])!;
    expect(c.recommendations.length).toBeGreaterThanOrEqual(1);
  });
});
