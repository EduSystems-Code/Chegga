import { describe, it, expect } from "vitest";
import { fetchLichessGames, parseNdjson, LichessHttpError, type LichessRawGame } from "../../src/lichessClient";
import { normalizeLichessGame } from "../../src/lichessNormalizer";
import { usernameProblem } from "../../src/siteSync";

// Shaped from a real response of GET /api/games/user/DrNykterstein
// (moves and clocks cut short). Black won by resignation.
const REAL: LichessRawGame = {
  id: "kAdOQKeh",
  rated: true,
  variant: "standard",
  speed: "blitz",
  createdAt: 1775677143033,
  lastMoveAt: 1775677513708,
  status: "resign",
  players: {
    white: { user: { name: "respects_55", id: "respects_55" }, rating: 2644 },
    black: { user: { name: "DrNykterstein", id: "drnykterstein" }, rating: 3145 },
  },
  winner: "black",
  opening: { eco: "B02", name: "Alekhine Defense: Sämisch Attack", ply: 5 },
  pgn:
    '[Event "Take Take Take Arena"]\n[White "respects_55"]\n[Black "DrNykterstein"]\n[Result "0-1"]\n' +
    '[TimeControl "180+0"]\n\n1. e4 { [%clk 0:03:00] } 1... Nf6 { [%clk 0:03:00] } 2. e5 { [%clk 0:02:59] } 0-1',
};

describe("normalizeLichessGame", () => {
  it("maps a decisive game to the same shape a Chess.com game gets", () => {
    const g = normalizeLichessGame(REAL, "DrNykterstein")!;
    expect(g).toMatchObject({
      chessComUuid: "lichess:kAdOQKeh",
      username: "DrNykterstein",
      url: "https://lichess.org/kAdOQKeh",
      timeControl: "180+0",
      timeClass: "blitz",
      rules: "chess",
      rated: true,
      endTime: 1775677513,
      eco: "B02",
      openingName: "Alekhine Defense: Sämisch Attack",
      whiteUsername: "respects_55",
      whiteRating: 2644,
      blackUsername: "DrNykterstein",
      blackRating: 3145,
      userColor: "black",
      userResult: "win",
      analyzed: false,
    });
  });

  it("gives the loser's code the Chess.com wording, so 'how games end' works", () => {
    const g = normalizeLichessGame(REAL, "DrNykterstein")!;
    expect(g.blackResult).toBe("win");
    expect(g.whiteResult).toBe("resigned");
    const mate = normalizeLichessGame({ ...REAL, status: "mate" }, "DrNykterstein")!;
    expect(mate.whiteResult).toBe("checkmated");
    const flag = normalizeLichessGame({ ...REAL, status: "outoftime" }, "DrNykterstein")!;
    expect(flag.whiteResult).toBe("timeout");
  });

  it("scores it from the tracked player's side, whichever colour they had", () => {
    expect(normalizeLichessGame(REAL, "respects_55")!.userResult).toBe("loss");
    expect(normalizeLichessGame(REAL, "RESPECTS_55")!.userColor).toBe("white"); // case does not matter
  });

  it("handles a draw", () => {
    const g = normalizeLichessGame({ ...REAL, winner: undefined, status: "stalemate" }, "DrNykterstein")!;
    expect(g.userResult).toBe("draw");
    expect(g.whiteResult).toBe("stalemate");
    expect(g.blackResult).toBe("stalemate");
  });

  it("maps speeds onto the four time classes the stats know", () => {
    const cls = (speed: string) => normalizeLichessGame({ ...REAL, speed }, "DrNykterstein")!.timeClass;
    expect(cls("ultraBullet")).toBe("bullet");
    expect(cls("classical")).toBe("rapid");
    expect(cls("correspondence")).toBe("daily");
  });

  it("takes the time control from the clock when the PGN has no header", () => {
    const g = normalizeLichessGame({ ...REAL, pgn: "1. e4 *", clock: { initial: 600, increment: 5 } }, "DrNykterstein")!;
    expect(g.timeControl).toBe("600+5");
  });

  it("marks variants so they are listed but never analyzed, and keeps from-position as chess", () => {
    expect(normalizeLichessGame({ ...REAL, variant: "chess960" }, "DrNykterstein")!.rules).toBe("chess960");
    expect(normalizeLichessGame({ ...REAL, variant: "fromPosition" }, "DrNykterstein")!.rules).toBe("chess");
  });

  it("skips games that never happened, and games the player was not in", () => {
    expect(normalizeLichessGame({ ...REAL, status: "aborted" }, "DrNykterstein")).toBeNull();
    expect(normalizeLichessGame({ ...REAL, status: "noStart" }, "DrNykterstein")).toBeNull();
    expect(normalizeLichessGame(REAL, "someone_else")).toBeNull();
  });

  it("names an anonymous opponent", () => {
    const g = normalizeLichessGame(
      { ...REAL, players: { white: { rating: 1500 }, black: { user: { name: "DrNykterstein" }, rating: 3145 } } },
      "DrNykterstein",
    )!;
    expect(g.whiteUsername).toBe("Anonymous");
  });
});

describe("parseNdjson", () => {
  it("reads one game per line and skips lines that are not games", () => {
    const text = `${JSON.stringify(REAL)}\nnot json\n\n${JSON.stringify({ ...REAL, id: "second" })}\n{"no":"id"}\n`;
    expect(parseNdjson(text).map((g) => g.id)).toEqual(["kAdOQKeh", "second"]);
  });
});

describe("fetchLichessGames", () => {
  function fakeFetch(status: number, body = ""): { impl: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(body, { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("asks for NDJSON with the PGN and the newest games, without a User-Agent", async () => {
    const { impl, calls } = fakeFetch(200, JSON.stringify(REAL));
    const games = await fetchLichessGames("Dr Nyk", { max: 30 }, impl);
    expect(games).toHaveLength(1);
    expect(calls[0].url).toContain("/api/games/user/Dr%20Nyk?");
    expect(calls[0].url).toContain("max=30");
    expect(calls[0].url).toContain("pgnInJson=true");
    expect(calls[0].url).toContain("clocks=true");
    expect(calls[0].init?.headers).toEqual({ Accept: "application/x-ndjson" });
  });

  it("passes 'since' for an incremental sync", async () => {
    const { impl, calls } = fakeFetch(200, "");
    await fetchLichessGames("x", { max: 10, sinceMs: 12345 }, impl);
    expect(calls[0].url).toContain("since=12345");
  });

  it("explains an unknown account", async () => {
    const { impl } = fakeFetch(404, '{"error":"Not found"}');
    await expect(fetchLichessGames("nobody_here", { max: 5 }, impl)).rejects.toThrow(/no account named "nobody_here"/);
  });

  it("explains a rate limit", async () => {
    const { impl } = fakeFetch(429, "");
    const err = await fetchLichessGames("x", { max: 5 }, impl).catch((e) => e);
    expect(err).toBeInstanceOf(LichessHttpError);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/wait a minute/i);
  });

  it("explains being offline", async () => {
    const impl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(fetchLichessGames("x", { max: 5 }, impl)).rejects.toThrow(/Could not reach Lichess/);
  });
});

describe("usernameProblem", () => {
  it("accepts real usernames from both sites", () => {
    for (const name of ["MichaelBottega", "DrNykterstein", "a_b-c9", "  padded  "]) {
      expect(usernameProblem(name)).toBeNull();
    }
  });

  it("rejects an empty name, an email address, and anything that could not be a username", () => {
    expect(usernameProblem("")).toMatch(/Type your username/);
    expect(usernameProblem("me@example.com")).toMatch(/letters, numbers/);
    expect(usernameProblem("two words")).toMatch(/letters, numbers/);
    expect(usernameProblem("../etc")).toMatch(/letters, numbers/);
    expect(usernameProblem("x")).toMatch(/letters, numbers/);
  });
});
