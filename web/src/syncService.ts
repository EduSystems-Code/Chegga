// Chegga Web — incremental Chess.com ingestion into IndexedDB (Phase 1)
//
// Ported from Chegga's own `app/services/sync_service.py::sync_games`:
// safe to re-run at any time, upserts by chess_com_uuid so re-running
// never duplicates, and skips any month already marked "complete" except
// the current month, which can still receive new games.
//
// Two entry points share the same per-month logic (processMonth):
// - syncGames: the original full-history walk, oldest month first.
// - quickSyncRecentGames: added as a direct response to "the player might
//   click off before seeing what this does" -- walks newest month first
//   and stops once it's collected enough games, instead of always pulling
//   an entire account's history (94 months on the account this was
//   verified against) before a visitor sees anything. Months it does
//   fetch are marked "complete" exactly like the full sync would, so a
//   later syncGames() call for "get my whole history" correctly resumes
//   on whatever's left over -- no separate resume logic needed, this
//   reuses syncGames' own existing skip-already-complete behavior.

import { ChessComClient, ChessComHttpError } from "./chessComClient";
import type { ChessComRawGame } from "./chessComClient";
import { gameExists, getSyncState, putGame, putSyncState } from "./db";
import { normalizeGame, UntrackedUserError } from "./gameNormalizer";

export interface SyncProgress {
  monthsProcessed: number;
  totalMonths: number;
  gamesAdded: number;
  currentMonth?: string;
}

export interface SyncResult {
  monthsProcessed: number;
  gamesAdded: number;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}
function yearMonthFromArchiveUrl(url: string): string {
  const parts = url.replace(/\/+$/, "").split("/");
  const month = parts[parts.length - 1];
  const year = parts[parts.length - 2];
  return `${year}-${month}`;
}

/** Fetches and upserts one archive month, marking it "complete" in
 * syncState (unless it's the current, still-in-progress month). Returns
 * `undefined` if this month was already complete and should be skipped
 * (caller decides what "skipped" means for its own progress reporting).
 * Shared by both syncGames and quickSyncRecentGames so "what counts as
 * done" can never drift between the two. */
async function processMonth(
  db: IDBDatabase,
  client: ChessComClient,
  username: string,
  archiveUrl: string,
  currentMonth: string,
): Promise<{ yearMonth: string; addedThisMonth: number } | undefined> {
  const yearMonth = yearMonthFromArchiveUrl(archiveUrl);

  const state = await getSyncState(db, username, yearMonth);
  if (state && state.status === "complete" && yearMonth !== currentMonth) {
    return undefined;
  }

  let rawGames: ChessComRawGame[];
  try {
    rawGames = await client.getArchive(archiveUrl);
  } catch (err) {
    // A month Chess.com's own archive-list endpoint names can still 404 on
    // the archive endpoint itself (observed live against a real account,
    // not a documented API behavior) -- treat it as an empty month rather
    // than aborting the whole sync over one bad URL. Any other error
    // (network failure, a genuine server error after retries) still
    // propagates -- this is deliberately narrow.
    if (err instanceof ChessComHttpError && err.status === 404) {
      console.warn(`Chess.com archive 404 for ${yearMonth} (${archiveUrl}) -- treating as an empty month`);
      rawGames = [];
    } else {
      throw err;
    }
  }

  let addedThisMonth = 0;
  for (const raw of rawGames) {
    if (!raw.uuid) continue;
    if (await gameExists(db, raw.uuid)) continue;

    let record;
    try {
      record = normalizeGame(raw, username, username);
    } catch (err) {
      if (err instanceof UntrackedUserError) {
        console.warn(`Skipping game ${raw.uuid}: tracked user not found among players`);
        continue;
      }
      throw err;
    }

    await putGame(db, record);
    addedThisMonth += 1;
  }

  await putSyncState(db, {
    username,
    yearMonth,
    status: yearMonth !== currentMonth ? "complete" : "partial",
    gamesFetched: (state?.gamesFetched ?? 0) + addedThisMonth,
    lastSyncedAt: Date.now(),
  });

  return { yearMonth, addedThisMonth };
}

export async function syncGames(
  db: IDBDatabase,
  client: ChessComClient,
  username: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const archiveUrls = await client.getArchiveUrls(username);
  const currentMonth = currentYearMonth();
  const totalMonths = archiveUrls.length;

  let monthsProcessed = 0;
  let gamesAdded = 0;

  for (const archiveUrl of archiveUrls) {
    const result = await processMonth(db, client, username, archiveUrl, currentMonth);
    monthsProcessed += 1;
    if (result) gamesAdded += result.addedThisMonth;
    // Reported even on a skip (already-synced month) -- a skipped month is
    // still real progress through the account's history, just not a
    // fetch. Not reporting these made the progress bar look frozen for a
    // re-sync where most months are already done, then jump to "done" all
    // at once.
    onProgress?.({ monthsProcessed, totalMonths, gamesAdded, currentMonth: result?.yearMonth ?? yearMonthFromArchiveUrl(archiveUrl) });
  }

  return { monthsProcessed, gamesAdded };
}

/** Fast first-sync: walks archive months newest-first and stops once
 * `targetGameCount` new games have been collected (or the account's
 * whole history has been read, whichever comes first) -- so a visitor
 * with thousands of games gets a first payoff in however long it takes
 * to fetch a handful of recent months, not their entire history. Months
 * it does fetch are marked complete exactly like a full sync, so calling
 * syncGames() afterward ("get my whole history") correctly picks up only
 * what's left, oldest-first, with zero duplicate work. */
export async function quickSyncRecentGames(
  db: IDBDatabase,
  client: ChessComClient,
  username: string,
  targetGameCount: number,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult & { fullyCaughtUp: boolean }> {
  const archiveUrls = await client.getArchiveUrls(username);
  const currentMonth = currentYearMonth();
  const totalMonths = archiveUrls.length;
  const newestFirst = [...archiveUrls].reverse();

  let monthsProcessed = 0;
  let gamesAdded = 0;

  for (const archiveUrl of newestFirst) {
    const result = await processMonth(db, client, username, archiveUrl, currentMonth);
    monthsProcessed += 1;
    if (result) gamesAdded += result.addedThisMonth;
    onProgress?.({ monthsProcessed, totalMonths, gamesAdded, currentMonth: result?.yearMonth ?? yearMonthFromArchiveUrl(archiveUrl) });

    if (gamesAdded >= targetGameCount) {
      return { monthsProcessed, gamesAdded, fullyCaughtUp: monthsProcessed >= totalMonths };
    }
  }

  return { monthsProcessed, gamesAdded, fullyCaughtUp: true };
}
