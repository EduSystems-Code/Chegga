import { describe, it, expect } from "vitest";
import { computeRivalRecords, computeRivalDeltas, snapshotEntry } from "../../src/rivalTracking";
import type { RivalSnapshotEntry } from "../../src/db";
import { game } from "./_factories";

function vs(opponent: string, userResult: "win" | "loss" | "draw", oppRating = 1500, endTime = 1_700_000_000) {
  return game({ blackUsername: opponent, blackRating: oppRating, userColor: "white", userResult, endTime });
}

describe("computeRivalRecords", () => {
  it("ignores opponents faced only once", () => {
    const records = computeRivalRecords([vs("solo", "win"), vs("rival", "win"), vs("rival", "loss")]);
    expect(records.map((r) => r.opponent)).toEqual(["rival"]);
    expect(records[0].games).toBe(2);
  });
});

describe("computeRivalDeltas", () => {
  const prev: RivalSnapshotEntry[] = [
    { opponent: "rival", games: 4, wins: 2, losses: 2, draws: 0, winRate: 0.5, recentAvgOpponentRating: 1500 },
    { opponent: "quiet", games: 3, wins: 1, losses: 2, draws: 0, winRate: 0.333, recentAvgOpponentRating: 1400 },
  ];

  it("reports only rivals with new games since the snapshot", () => {
    const current = computeRivalRecords([
      // rival: 4 old + 2 new wins
      ...Array.from({ length: 4 }, () => vs("rival", "win")),
      ...Array.from({ length: 2 }, () => vs("rival", "win")),
      // quiet: same 3 games as the snapshot, nothing new
      ...Array.from({ length: 3 }, () => vs("quiet", "loss")),
    ]);
    // force the known baseline counts so the delta is unambiguous
    const rivalNow = current.find((r) => r.opponent === "rival")!;
    rivalNow.games = 6;
    rivalNow.wins = 4;
    rivalNow.winRate = 4 / 6;

    const deltas = computeRivalDeltas(current, prev);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].opponent).toBe("rival");
    expect(deltas[0].newGames).toBe(2);
    expect(deltas[0].winsDelta).toBe(2);
    expect(deltas[0].winRateDelta).toBeGreaterThan(0); // 0.667 - 0.5
  });

  it("skips a rival that is new since the snapshot (no baseline to diff)", () => {
    const current = computeRivalRecords([vs("fresh", "win"), vs("fresh", "loss")]);
    expect(computeRivalDeltas(current, prev)).toEqual([]);
  });

  it("carries an opponent-rating delta only when both sides know it", () => {
    const current = [
      { opponent: "rival", games: 6, wins: 3, losses: 3, draws: 0, winRate: 0.5, recentAvgOpponentRating: 1560, lastPlayed: 0 },
      { opponent: "quiet", games: 5, wins: 2, losses: 3, draws: 0, winRate: 0.4, recentAvgOpponentRating: undefined, lastPlayed: 0 },
    ];
    const deltas = computeRivalDeltas(current as any, prev);
    const rival = deltas.find((d) => d.opponent === "rival")!;
    const quiet = deltas.find((d) => d.opponent === "quiet")!;
    expect(rival.opponentRatingDelta).toBe(60);
    expect(quiet.opponentRatingDelta).toBeUndefined();
  });
});

describe("snapshotEntry", () => {
  it("projects a record down to the persisted fields", () => {
    const [rec] = computeRivalRecords([vs("rival", "win"), vs("rival", "loss")]);
    const entry = snapshotEntry(rec);
    expect(Object.keys(entry).sort()).toEqual(
      ["draws", "games", "losses", "opponent", "recentAvgOpponentRating", "winRate", "wins"].sort(),
    );
  });
});
