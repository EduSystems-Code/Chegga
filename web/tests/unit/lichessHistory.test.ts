import { describe, it, expect, vi, afterEach } from "vitest";
import { streamLichessGames, type LichessRawGame } from "../../src/lichessClient";
import { normalizeLichessGame } from "../../src/lichessNormalizer";
import {
  createdAtCeilingMs,
  syncLichessFullHistory,
  LICHESS_RATE_LIMIT_WAIT_MS,
  type HistoryStore,
} from "../../src/lichessHistory";
import { SiteSyncError } from "../../src/siteSync";
import type { GameRecord } from "../../src/db";

const USER = "tester";
const BASE = Date.UTC(2026, 3, 8, 18, 0, 0); // newest game: 2026-04-08 18:00:00 UTC

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Game `i` (0 = newest), one minute apart, with the same PGN date headers
 * Lichess sends. */
function rawGame(i: number): LichessRawGame {
  const createdAt = BASE - i * 60_000;
  const d = new Date(createdAt);
  const pgn =
    `[Event "Rated blitz game"]\n[UTCDate "${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}"]\n` +
    `[UTCTime "${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}"]\n[TimeControl "180+0"]\n\n1. e4 e5 1-0`;
  return {
    id: `g${String(i).padStart(4, "0")}`,
    rated: true,
    variant: "standard",
    speed: "blitz",
    createdAt,
    lastMoveAt: createdAt + 200_000,
    status: "resign",
    players: {
      white: { user: { name: USER, id: USER }, rating: 1500 },
      black: { user: { name: "rival", id: "rival" }, rating: 1500 },
    },
    winner: "white",
    opening: { eco: "C20", name: "Sämisch Attack" },
    pgn,
  };
}

const encoder = new TextEncoder();

/** A body that arrives in `chunkSize`-byte pieces, so lines (and multi-byte
 * characters) are cut in the middle. */
function chunkedBody(text: string, chunkSize: number, onCancel?: () => void): ReadableStream<Uint8Array> {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel() {
      onCancel?.();
    },
  });
}

const ndjson = (games: LichessRawGame[]) => games.map((g) => JSON.stringify(g)).join("\n") + (games.length ? "\n" : "");

/** A fake Lichess: `total` games, newest first; honours `max` and `until`.
 * Records every request and how many overlapped. */
function fakeLichess(total: number, opts: { chunkSize?: number; failAfterGames?: number } = {}) {
  const all = Array.from({ length: total }, (_, i) => rawGame(i));
  const urls: string[] = [];
  const headers: unknown[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let cancelled = 0;
  let failBudget = opts.failAfterGames;

  const impl = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    headers.push(init?.headers);
    const q = new URL(url).searchParams;
    const until = q.has("until") ? Number(q.get("until")) : Infinity;
    const max = Number(q.get("max"));
    const page = all.filter((g) => g.createdAt! <= until).slice(0, max);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    let body: ReadableStream<Uint8Array>;
    if (failBudget !== undefined) {
      // Deliver `failBudget` games, then break the connection.
      const part = page.slice(0, failBudget);
      failBudget = undefined;
      const bytes = encoder.encode(ndjson(part));
      let sent = false;
      body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(bytes);
            return;
          }
          controller.error(new TypeError("network error"));
        },
      });
    } else {
      body = chunkedBody(ndjson(page), opts.chunkSize ?? 37, () => (cancelled += 1));
    }
    // Count the request as finished when its body is done being read.
    const done = () => (inFlight -= 1);
    const reader = body.getReader();
    const wrapped = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const r = await reader.read();
          if (r.done) {
            done();
            controller.close();
          } else controller.enqueue(r.value);
        } catch (e) {
          done();
          controller.error(e);
        }
      },
      cancel() {
        done();
        return reader.cancel(); // chunkedBody's own onCancel increments `cancelled`
      },
    });
    return new Response(wrapped, { status: 200 });
  }) as unknown as typeof fetch;

  return {
    impl,
    urls,
    headers,
    all,
    get maxInFlight() {
      return maxInFlight;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

function memoryStore(seed: GameRecord[] = []) {
  const rows = new Map<string, GameRecord>(seed.map((g) => [g.chessComUuid, g]));
  const store: HistoryStore = {
    has: async (id) => rows.has(id),
    put: async (g) => void rows.set(g.chessComUuid, g),
    lichessGames: async (username) => [...rows.values()].filter((g) => g.username === username),
  };
  return { store, rows };
}

function stored(i: number): GameRecord {
  return normalizeLichessGame(rawGame(i), USER)!;
}

const untilOf = (url: string) => new URL(url).searchParams.get("until");

afterEach(() => {
  vi.useRealTimers();
});

describe("streamLichessGames", () => {
  it("reads a line that is split across chunks, including a split multi-byte character", async () => {
    const games = [rawGame(0), rawGame(1), rawGame(2)];
    for (const chunkSize of [1, 3, 7, 50]) {
      const impl = (async () => new Response(chunkedBody(ndjson(games), chunkSize), { status: 200 })) as unknown as typeof fetch;
      const got: LichessRawGame[] = [];
      for await (const g of streamLichessGames(USER, { max: 10 }, impl)) got.push(g);
      expect(got.map((g) => g.id), `chunk size ${chunkSize}`).toEqual(games.map((g) => g.id));
      expect(got[0].opening?.name).toBe("Sämisch Attack");
      expect(got[0].pgn).toBe(games[0].pgn);
    }
  });

  it("reads a last line that has no newline, and skips lines that are not games", async () => {
    const text = `${JSON.stringify(rawGame(0))}\nnot json\n\n${JSON.stringify(rawGame(1))}`;
    const impl = (async () => new Response(chunkedBody(text, 11), { status: 200 })) as unknown as typeof fetch;
    const got: string[] = [];
    for await (const g of streamLichessGames(USER, { max: 10 }, impl)) got.push(g.id);
    expect(got).toEqual(["g0000", "g0001"]);
  });

  it("asks for the same fields as every other Lichess request, plus max and until", async () => {
    const lichess = fakeLichess(1);
    for await (const g of streamLichessGames("Dr Nyk", { max: 50, untilMs: 1234 }, lichess.impl)) void g;
    const url = lichess.urls[0];
    expect(url).toContain("/api/games/user/Dr%20Nyk?");
    for (const part of ["max=50", "until=1234", "pgnInJson=true", "clocks=true", "opening=true"]) expect(url).toContain(part);
    expect(url).not.toContain("since=");
    expect(lichess.headers[0]).toEqual({ Accept: "application/x-ndjson", signal: undefined });
  });
});

describe("syncLichessFullHistory", () => {
  it("pages backwards with `until`, one request at a time, and stops at the start of the history", async () => {
    const lichess = fakeLichess(5);
    const { store, rows } = memoryStore();
    const seen: string[] = [];
    const result = await syncLichessFullHistory(store, USER, {
      pageSize: 2,
      fetchImpl: lichess.impl,
      onProgress: (t) => seen.push(t),
    });

    expect(result).toEqual({ gamesAdded: 5, finished: true, cancelled: false, emptyAccount: false });
    expect(rows.size).toBe(5);
    expect(lichess.urls).toHaveLength(3); // 2 + 2 + 1 (short page: the end)
    expect(untilOf(lichess.urls[0])).toBeNull(); // nothing stored: from the newest
    expect(untilOf(lichess.urls[1])).toBe(String(lichess.all[1].createdAt! - 1)); // oldest of page 1, minus 1 ms
    expect(untilOf(lichess.urls[2])).toBe(String(lichess.all[3].createdAt! - 1));
    expect(lichess.maxInFlight).toBe(1);
    expect(seen.at(-1)).toBe("Reading your Lichess games — 5 new games so far");
  });

  it("asks once more when the last page is exactly full, and stops on the empty one", async () => {
    const lichess = fakeLichess(4);
    const { store } = memoryStore();
    const result = await syncLichessFullHistory(store, USER, { pageSize: 2, fetchImpl: lichess.impl });
    expect(result.gamesAdded).toBe(4);
    expect(result.finished).toBe(true);
    expect(lichess.urls).toHaveLength(3);
  });

  it("skips games that are already stored and counts only the new ones", async () => {
    const lichess = fakeLichess(6);
    const { store, rows } = memoryStore([stored(0), stored(1), stored(2)]);
    const result = await syncLichessFullHistory(store, USER, { pageSize: 10, fetchImpl: lichess.impl });

    expect(result.gamesAdded).toBe(3); // games 3, 4 and 5
    expect(rows.size).toBe(6);
    expect(new Set(rows.keys()).size).toBe(6);
    // It started below the oldest stored game (game 2), not from the newest.
    expect(untilOf(lichess.urls[0])).toBe(String(createdAtCeilingMs(stored(2))));
    expect(Number(untilOf(lichess.urls[0]))).toBeGreaterThanOrEqual(lichess.all[2].createdAt!);
    expect(Number(untilOf(lichess.urls[0]))).toBeLessThan(lichess.all[1].createdAt!);
  });

  it("finds nothing new when the whole history is already stored", async () => {
    const lichess = fakeLichess(3);
    const { store } = memoryStore([stored(0), stored(1), stored(2)]);
    const result = await syncLichessFullHistory(store, USER, { pageSize: 50, fetchImpl: lichess.impl });
    expect(result).toEqual({ gamesAdded: 0, finished: true, cancelled: false, emptyAccount: false });
    expect(lichess.urls).toHaveLength(1);
  });

  it("resumes below the oldest stored game after a run that broke off", async () => {
    // First run: the connection drops after 3 games of a 10-game history.
    const broken = fakeLichess(10, { failAfterGames: 3 });
    const { store, rows } = memoryStore();
    const firstError = await syncLichessFullHistory(store, USER, { pageSize: 4, fetchImpl: broken.impl }).catch((e) => e);
    expect(firstError).toBeInstanceOf(SiteSyncError);
    expect(rows.size).toBe(3); // stored as they arrived, newest first

    // Second run: starts just below game 2, never from zero, and finishes the rest.
    const healthy = fakeLichess(10);
    const result = await syncLichessFullHistory(store, USER, { pageSize: 4, fetchImpl: healthy.impl });
    expect(result.gamesAdded).toBe(7);
    expect(result.finished).toBe(true);
    expect(rows.size).toBe(10);
    expect(untilOf(healthy.urls[0])).toBe(String(createdAtCeilingMs(stored(2))));
  });

  it("stops when cancelled, keeps what it stored, closes the connection, and resumes later", async () => {
    const lichess = fakeLichess(10);
    const { store, rows } = memoryStore();
    const abort = new AbortController();
    let games = 0;
    const result = await syncLichessFullHistory(store, USER, {
      pageSize: 5,
      fetchImpl: lichess.impl,
      signal: abort.signal,
      onProgress: () => {
        games += 1;
        if (games === 2) abort.abort();
      },
    });
    expect(result).toMatchObject({ cancelled: true, finished: false, gamesAdded: 2 });
    expect(rows.size).toBe(2);
    expect(lichess.urls).toHaveLength(1); // no second page
    expect(lichess.cancelled).toBe(1); // the rest of the body was not read

    const again = await syncLichessFullHistory(store, USER, { pageSize: 5, fetchImpl: fakeLichess(10).impl });
    expect(again.gamesAdded).toBe(8);
    expect(rows.size).toBe(10);
  });

  it("does not start when already cancelled", async () => {
    const lichess = fakeLichess(3);
    const abort = new AbortController();
    abort.abort();
    const result = await syncLichessFullHistory(memoryStore().store, USER, { fetchImpl: lichess.impl, signal: abort.signal });
    expect(result.cancelled).toBe(true);
    expect(lichess.urls).toHaveLength(0);
  });

  it("waits a full 60 seconds after a 429, shows the wait, then asks the same page again", async () => {
    vi.useFakeTimers();
    const lichess = fakeLichess(3);
    let calls = 0;
    const impl = (async (url: string, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429 });
      return lichess.impl(url, init);
    }) as unknown as typeof fetch;

    const { store, rows } = memoryStore();
    const texts: string[] = [];
    const run = syncLichessFullHistory(store, USER, { pageSize: 10, fetchImpl: impl, onProgress: (t) => texts.push(t) });

    await vi.advanceTimersByTimeAsync(LICHESS_RATE_LIMIT_WAIT_MS - 1);
    expect(calls).toBe(1); // still waiting
    expect(texts.some((t) => /slow down — waiting \d+ s/.test(t))).toBe(true);
    expect(texts[0]).toContain("waiting 60 s");

    await vi.advanceTimersByTimeAsync(1);
    const result = await run;
    expect(calls).toBe(2);
    expect(result).toMatchObject({ gamesAdded: 3, finished: true });
    expect(rows.size).toBe(3);
  });

  it("can be cancelled during the 429 wait", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as unknown as typeof fetch;
    const abort = new AbortController();
    const run = syncLichessFullHistory(memoryStore().store, USER, { fetchImpl: impl, signal: abort.signal });
    await vi.advanceTimersByTimeAsync(5_000);
    abort.abort();
    const result = await run;
    expect(result.cancelled).toBe(true);
    expect(calls).toBe(1);
  });

  it("gives up with a plain message after repeated rate limits", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as unknown as typeof fetch;
    const run = syncLichessFullHistory(memoryStore().store, USER, { fetchImpl: impl }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(LICHESS_RATE_LIMIT_WAIT_MS * 6);
    const err = await run;
    expect(err).toBeInstanceOf(SiteSyncError);
    expect(err.message).toMatch(/slow down/i);
    expect(calls).toBe(6);
  });

  it("reports an empty account as finished with nothing added", async () => {
    const lichess = fakeLichess(0);
    const result = await syncLichessFullHistory(memoryStore().store, USER, { fetchImpl: lichess.impl });
    expect(result).toEqual({ gamesAdded: 0, finished: true, cancelled: false, emptyAccount: true });
    expect(lichess.urls).toHaveLength(1);
  });

  it("says so when the username does not exist", async () => {
    const impl = (async () => new Response('{"error":"Not found"}', { status: 404 })) as unknown as typeof fetch;
    const { store, rows } = memoryStore();
    const err = await syncLichessFullHistory(store, "nobody_here", { fetchImpl: impl }).catch((e) => e);
    expect(err).toBeInstanceOf(SiteSyncError);
    expect(err.message).toMatch(/no account named "nobody_here"/);
    expect(rows.size).toBe(0);
  });

  it("leaves games it cannot normalize out, and still pages past them", async () => {
    const aborted = { ...rawGame(1), status: "aborted" };
    const all = [rawGame(0), aborted, rawGame(2)];
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const until = new URL(url).searchParams.get("until");
      const page = until ? all.filter((g) => g.createdAt! <= Number(until)) : all;
      return new Response(ndjson(page.slice(0, 2)), { status: 200 });
    }) as unknown as typeof fetch;
    const { store, rows } = memoryStore();
    const result = await syncLichessFullHistory(store, USER, { pageSize: 2, fetchImpl: impl });
    expect(result.gamesAdded).toBe(2); // the aborted game is not stored
    expect([...rows.keys()].sort()).toEqual(["lichess:g0000", "lichess:g0002"]);
  });
});

describe("createdAtCeilingMs", () => {
  it("reads the creation time from the PGN headers, rounded up to the end of the second", () => {
    expect(createdAtCeilingMs(stored(0))).toBe(BASE + 999);
  });

  it("falls back to the last move's time when the PGN has no date", () => {
    const game = { ...stored(0), pgn: "1. e4 e5 *" };
    expect(createdAtCeilingMs(game)).toBe(game.endTime * 1000 + 999);
  });
});
