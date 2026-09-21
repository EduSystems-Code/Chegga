import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  confirmMoment,
  findMomentInGames,
  scanGameForMoment,
  scoreMoment,
  SCAN_DEFAULTS,
  GOOD_SCORE,
  type EngineLike,
  type TeachableMoment,
} from "../../src/tutorialMoment";
import type { AnalysisLine } from "../../src/engine";
import { game } from "./_factories";

// 1. e4 e5 2. Qh5 Nc6 3. Qxe5+?? Nxe5 -- White (the reviewer) hangs the queen on move 3.
const PGN = "1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5";

/** Position before each ply, then the final one. */
function fensOf(pgn: string): string[] {
  const c = new Chess();
  c.loadPgn(pgn);
  const fens = c.history({ verbose: true }).map((m) => m.before);
  fens.push(c.fen());
  return fens;
}
const FENS = fensOf(PGN);
const key = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** An engine that answers from a table and otherwise says "level, first legal move". */
function fakeEngine(table: Record<string, { cp?: number; mate?: number; pv: string }>, calls: string[] = []): EngineLike {
  return {
    async analyse(fen) {
      calls.push(fen);
      const hit = table[key(fen)];
      if (hit) return [{ multipv: 1, depth: 12, scoreCp: hit.cp, scoreMate: hit.mate, pv: [hit.pv] }];
      const first = new Chess(fen).moves({ verbose: true })[0];
      if (!first) return [];
      return [{ multipv: 1, depth: 12, scoreCp: 0, pv: [first.from + first.to] }];
    },
  };
}

// Before 3.Qxe5+ the engine likes Bc4 (+20); after it, Black to move sees +900 with Nxe5.
const BLUNDER_TABLE = {
  [key(FENS[4])]: { cp: 20, pv: "f1c4" },
  [key(FENS[5])]: { cp: 900, pv: "c6e5" },
};

const OPTS = { ...SCAN_DEFAULTS, minPly: 1 };

describe("scoreMoment", () => {
  it("rewards a concrete reason, a nameable best move, and a position still alive", () => {
    expect(scoreMoment({ centipawnLoss: 400, blunderTag: "hung_material", bestClause: "captures the pawn", evalBeforeMover: 50 })).toBe(7);
    expect(scoreMoment({ centipawnLoss: 400, blunderTag: "positional", bestClause: null, evalBeforeMover: -250 })).toBe(3);
  });

  it("stops looking once a moment is clear enough", () => {
    expect(scoreMoment({ centipawnLoss: 900, blunderTag: "hung_material", bestClause: "develops your bishop", evalBeforeMover: 20 })).toBeGreaterThanOrEqual(GOOD_SCORE);
  });
});

describe("scanGameForMoment", () => {
  const g = game({ pgn: PGN, userColor: "white", blackUsername: "rival" });

  it("finds the hung queen, says what was played and what was better", async () => {
    const { moment } = await scanGameForMoment(fakeEngine(BLUNDER_TABLE), g, OPTS);
    expect(moment).toMatchObject({
      ply: 5,
      moveNumber: 3,
      playedSan: "Qxe5+",
      bestSan: "Bc4",
      bestUci: "f1c4",
      blunderTag: "hung_material",
      classification: "blunder",
      userColor: "white",
      opponent: "rival",
      gamePhase: "opening",
      isExample: false,
    });
    expect(moment!.centipawnLoss).toBe(920);
    expect(moment!.fenBefore).toBe(FENS[4]);
    expect(moment!.previousMove).toEqual({ from: "b8", to: "c6" }); // the opponent's move that led here
    expect(moment!.id).toBe(`${g.chessComUuid}:5`);
  });

  it("stores the evals White-relative, like the analysis records do", async () => {
    const { moment } = await scanGameForMoment(fakeEngine(BLUNDER_TABLE), g, OPTS);
    expect(moment!.evalBeforeCp).toBe(20);
    expect(moment!.evalAfterCp).toBe(-900); // Black to move sees +900, so White is at -900
  });

  it("skips the opening when told to, without analyzing it", async () => {
    const calls: string[] = [];
    const { moment } = await scanGameForMoment(fakeEngine(BLUNDER_TABLE, calls), g, { ...OPTS, minPly: 5 });
    expect(moment?.ply).toBe(5);
    expect(calls).not.toContain(FENS[0]); // never analyzed the start position
    expect(calls).not.toContain(FENS[1]);
  });

  it("ignores the opponent's mistakes, and its own moves that lose little", async () => {
    const asBlack = game({ pgn: PGN, userColor: "black" });
    const { moment } = await scanGameForMoment(fakeEngine(BLUNDER_TABLE), asBlack, OPTS);
    expect(moment).toBeNull(); // Black's Nxe5 was fine

    const small = fakeEngine({ [key(FENS[4])]: { cp: 20, pv: "f1c4" }, [key(FENS[5])]: { cp: -10, pv: "c6e5" } });
    expect((await scanGameForMoment(small, g, OPTS)).moment).toBeNull();
  });

  it("does not teach from a position that was already lost", async () => {
    const lost = fakeEngine({ [key(FENS[4])]: { cp: -600, pv: "f1c4" }, [key(FENS[5])]: { cp: 900, pv: "c6e5" } });
    expect((await scanGameForMoment(lost, g, OPTS)).moment).toBeNull();
  });

  it("stops at the deadline", async () => {
    let t = 0;
    const result = await scanGameForMoment(fakeEngine(BLUNDER_TABLE), g, { ...OPTS, deadline: 100 }, { now: () => (t += 60) });
    expect(result.timedOut).toBe(true);
  });

  it("stops when asked", async () => {
    const calls: string[] = [];
    await scanGameForMoment(fakeEngine(BLUNDER_TABLE, calls), g, OPTS, { shouldStop: () => true });
    expect(calls).toHaveLength(0);
  });

  it("counts positions and reports each one", async () => {
    let reported = 0;
    const r = await scanGameForMoment(fakeEngine(BLUNDER_TABLE), g, OPTS, { onPosition: () => (reported += 1) });
    expect(reported).toBe(r.positionsAnalyzed);
    expect(r.positionsAnalyzed).toBeGreaterThan(0);
  });
});

describe("findMomentInGames", () => {
  const boring = game({ chessComUuid: "boring", pgn: "1. e4 e5 2. Nf3 Nc6", endTime: 3000, userColor: "white" });
  const blunder = game({ chessComUuid: "blunder", pgn: PGN, endTime: 2000, userColor: "white" });
  const variant = game({ chessComUuid: "variant", pgn: PGN, endTime: 4000, rules: "chess960" });

  it("looks newest first, skips variants, and returns the first clear moment", async () => {
    const found = await findMomentInGames(fakeEngine(BLUNDER_TABLE), [blunder, boring, variant], OPTS);
    expect(found?.game.chessComUuid).toBe("blunder");
    expect(found?.moment.ply).toBe(5);
  });

  it("returns null when nothing is worth teaching", async () => {
    expect(await findMomentInGames(fakeEngine({}), [boring], OPTS)).toBeNull();
  });

  it("survives a game the parser cannot read", async () => {
    const broken = game({ chessComUuid: "broken", pgn: "1. e4 e4 e4 nonsense", endTime: 5000 });
    const found = await findMomentInGames(fakeEngine(BLUNDER_TABLE), [broken, blunder], OPTS);
    expect(found?.game.chessComUuid).toBe("blunder");
  });

  it("can be told to skip a moment it already rejected", async () => {
    const first = await findMomentInGames(fakeEngine(BLUNDER_TABLE), [blunder], OPTS);
    const again = await findMomentInGames(fakeEngine(BLUNDER_TABLE), [blunder], { ...OPTS, exclude: new Set([first!.moment.id]) });
    expect(again).toBeNull();
  });

  it("reports which game it is on", async () => {
    const seen: string[] = [];
    await findMomentInGames(fakeEngine({}), [blunder, boring], OPTS, { onGame: (i) => seen.push(i.game.chessComUuid) });
    expect(seen).toEqual(["boring", "blunder"]); // newest game first
  });
});

describe("confirmMoment", () => {
  const moment = { fenBefore: FENS[4], playedUci: "h5e5", bestUci: "f1c4", bestSan: "Bc4" } as TeachableMoment;
  const line = (multipv: number, scoreCp: number, uci: string): AnalysisLine => ({ multipv, depth: 13, scoreCp, pv: [uci] });

  it("keeps a moment the deeper search agrees with, using the deeper best move", () => {
    const deep = [line(1, 20, "b1c3"), line(2, 10, "f1c4"), line(3, -700, "h5e5")];
    const confirmed = confirmMoment(moment, deep)!;
    expect(confirmed.bestUci).toBe("b1c3");
    expect(confirmed.bestSan).toBe("Nc3");
  });

  it("drops a moment when the played move turns out to be fine", () => {
    expect(confirmMoment(moment, [line(1, 20, "f1c4"), line(2, 5, "h5e5")])).toBeNull();
  });

  it("treats a played move outside the top lines as a miss only when the lines shown already fall far short", () => {
    const smallLoss = { ...moment, centipawnLoss: 160 };
    expect(confirmMoment(smallLoss, [line(1, 20, "f1c4"), line(2, -150, "b1c3")])?.bestUci).toBe("f1c4");
    expect(confirmMoment(smallLoss, [line(1, 20, "f1c4"), line(2, 10, "b1c3")])).toBeNull(); // the played move could be nearly as good
  });

  it("trusts a big loss from the scan when the played move is outside the lines shown", () => {
    const big = { ...moment, centipawnLoss: 620 };
    expect(confirmMoment(big, [line(1, 20, "f1c4"), line(2, 10, "b1c3")])?.bestUci).toBe("f1c4");
  });

  it("drops a moment with no lines", () => {
    expect(confirmMoment(moment, [])).toBeNull();
  });
});
