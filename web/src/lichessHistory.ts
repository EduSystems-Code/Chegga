// Chegga Web — full-history sync for Lichess
//
// Lichess has no monthly archives, so the whole history is read newest to
// oldest in pages, each page one request asking for games up to a time
// (`until`). Two rules from Lichess's own API docs shape this file:
//   - one request at a time (a page finishes before the next starts);
//   - on HTTP 429, wait a full minute before the next request.
//
// It is resumable without any extra saved state. Games are stored as they
// arrive, newest first, so what is stored is always an unbroken run from the
// newest game down to some oldest one. A new run starts just below that
// oldest game and never starts from zero. It only stores games; analysis stays
// on demand.

import type { GameRecord } from "./db";
import { gameExists, getGamesByUsername, putGame } from "./db";
import { LichessHttpError, streamLichessGames } from "./lichessClient";
import { LICHESS_ID_PREFIX, normalizeLichessGame } from "./lichessNormalizer";
import { SiteSyncError } from "./siteSync";

export const LICHESS_HISTORY_PAGE_SIZE = 200;
/** Lichess: "wait a full minute" after a 429. */
export const LICHESS_RATE_LIMIT_WAIT_MS = 60_000;
/** Give up (and keep what is saved) after this many 429s in a row. */
const MAX_RATE_LIMITS_IN_A_ROW = 5;

/** What the sync needs from storage, so it can be tested without IndexedDB. */
export interface HistoryStore {
  has(id: string): Promise<boolean>;
  put(game: GameRecord): Promise<void>;
  /** Every stored Lichess game for this username. */
  lichessGames(username: string): Promise<GameRecord[]>;
}

export function idbHistoryStore(db: IDBDatabase): HistoryStore {
  return {
    has: (id) => gameExists(db, id),
    put: (game) => putGame(db, game),
    lichessGames: async (username) =>
      (await getGamesByUsername(db, username)).filter((g) => g.chessComUuid.startsWith(LICHESS_ID_PREFIX)),
  };
}

export interface LichessHistoryResult {
  gamesAdded: number;
  /** true when the start of the account's history was reached */
  finished: boolean;
  cancelled: boolean;
  /** no stored games before this run and none on Lichess */
  emptyAccount: boolean;
}

export interface LichessHistoryOptions {
  pageSize?: number;
  signal?: AbortSignal;
  /** Text for the status line: the running count, or the rate-limit wait. */
  onProgress?: (text: string) => void;
  fetchImpl?: typeof fetch;
}

/** When a stored game was created, in ms, rounded UP to the end of its
 * second. The stored record keeps no `createdAt`, but Lichess's own PGN
 * headers carry it to the second; the fallback (the last move's time) is
 * never earlier than the creation time. Rounding up means the next request
 * can only ask for too much (a game or two already stored, which are
 * skipped), never for too little. */
export function createdAtCeilingMs(game: GameRecord): number {
  const date = /\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]/.exec(game.pgn);
  const time = /\[UTCTime "(\d{2}):(\d{2}):(\d{2})"\]/.exec(game.pgn);
  if (date && time) {
    const ms = Date.UTC(+date[1], +date[2] - 1, +date[3], +time[1], +time[2], +time[3]);
    if (Number.isFinite(ms)) return ms + 999;
  }
  return game.endTime * 1000 + 999;
}

/** `until` for the first request of a run: just below the oldest stored
 * game, or nothing (start from the newest) when nothing is stored. */
export function resumeUntilMs(stored: GameRecord[]): number | undefined {
  if (!stored.length) return undefined;
  return Math.min(...stored.map(createdAtCeilingMs));
}

/** Waits `ms`, or less if `signal` aborts. Never rejects. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done);
  });
}

export async function syncLichessFullHistory(
  store: HistoryStore,
  username: string,
  opts: LichessHistoryOptions = {},
): Promise<LichessHistoryResult> {
  const pageSize = opts.pageSize ?? LICHESS_HISTORY_PAGE_SIZE;
  const { signal, onProgress, fetchImpl } = opts;

  const storedAtStart = await store.lichessGames(username);
  let untilMs = resumeUntilMs(storedAtStart);
  let gamesAdded = 0;
  let gamesSeen = 0;
  let rateLimitsInARow = 0;

  const count = () => `${gamesAdded} new games so far`;
  const outcome = (finished: boolean, cancelled: boolean): LichessHistoryResult => ({
    gamesAdded,
    finished,
    cancelled,
    emptyAccount: finished && gamesSeen === 0 && storedAtStart.length === 0,
  });

  for (;;) {
    if (signal?.aborted) return outcome(false, true);

    let seenThisPage = 0;
    let oldestMs: number | undefined;
    try {
      for await (const raw of streamLichessGames(username, { max: pageSize, untilMs }, fetchImpl, signal)) {
        seenThisPage += 1;
        gamesSeen += 1;
        const createdAt = raw.createdAt ?? raw.lastMoveAt;
        if (createdAt !== undefined && (oldestMs === undefined || createdAt < oldestMs)) oldestMs = createdAt;

        const record = normalizeLichessGame(raw, username);
        if (record && !(await store.has(record.chessComUuid))) {
          await store.put(record);
          gamesAdded += 1;
        }
        onProgress?.(`Reading your Lichess games — ${count()}`);
        if (signal?.aborted) return outcome(false, true);
      }
    } catch (err) {
      if (err instanceof LichessHttpError && err.status === 429) {
        rateLimitsInARow += 1;
        if (rateLimitsInARow > MAX_RATE_LIMITS_IN_A_ROW) {
          throw new SiteSyncError("Lichess keeps asking us to slow down. Try again in a few minutes.");
        }
        // Lichess's rule: a full minute with no request at all.
        for (let left = LICHESS_RATE_LIMIT_WAIT_MS / 1000; left > 0 && !signal?.aborted; left--) {
          onProgress?.(`Lichess asked us to slow down — waiting ${left} s before the next request. ${count()}`);
          await pause(1000, signal);
        }
        continue; // the same page again: nothing new was stored from it
      }
      if (err instanceof LichessHttpError) throw new SiteSyncError(err.message);
      throw err;
    }
    if (signal?.aborted) return outcome(false, true);
    rateLimitsInARow = 0;

    if (seenThisPage < pageSize) return outcome(true, false); // the start of the history

    // A full page: ask for the games created before the oldest one on it.
    if (oldestMs === undefined) {
      throw new SiteSyncError("Lichess sent games without dates, so the sync could not continue. Try again later.");
    }
    const next = oldestMs - 1;
    if (untilMs !== undefined && next >= untilMs) {
      throw new SiteSyncError("Lichess sent the same games again, so the sync stopped. Try again later.");
    }
    untilMs = next;
  }
}
