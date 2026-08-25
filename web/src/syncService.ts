// Chegga Web — incremental Chess.com ingestion into IndexedDB (Phase 1)
//
// Ported from Chegga's own `app/services/sync_service.py::sync_games`:
// safe to re-run at any time, upserts by chess_com_uuid so re-running
// never duplicates, and skips any month already marked "complete" except
// the current month, which can still receive new games.

import { ChessComClient, ChessComHttpError } from "./chessComClient";
import type { ChessComRawGame } from "./chessComClient";
import { gameExists, getSyncState, putGame, putSyncState } from "./db";
import { normalizeGame, UntrackedUserError } from "./gameNormalizer";

export interface SyncProgress {
  monthsProcessed: number;
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

export async function syncGames(
  db: IDBDatabase,
  client: ChessComClient,
  username: string,
  onProgress?: (progress: SyncProgress) => void,
): Promise<SyncResult> {
  const archiveUrls = await client.getArchiveUrls(username);
  const currentMonth = currentYearMonth();

  let monthsProcessed = 0;
  let gamesAdded = 0;

  for (const archiveUrl of archiveUrls) {
    const yearMonth = yearMonthFromArchiveUrl(archiveUrl);

    const state = await getSyncState(db, username, yearMonth);
    if (state && state.status === "complete" && yearMonth !== currentMonth) {
      continue;
    }

    let rawGames: ChessComRawGame[];
    try {
      rawGames = await client.getArchive(archiveUrl);
    } catch (err) {
      // A month Chess.com's own archive-list endpoint names can still
      // 404 on the archive endpoint itself (observed live against a real
      // account, not a documented API behavior) -- treat it as an empty
      // month rather than aborting the whole sync over one bad URL. Any
      // other error (network failure, a genuine server error after
      // retries) still propagates -- this is deliberately narrow.
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

    monthsProcessed += 1;
    gamesAdded += addedThisMonth;
    onProgress?.({ monthsProcessed, gamesAdded, currentMonth: yearMonth });
  }

  return { monthsProcessed, gamesAdded };
}
