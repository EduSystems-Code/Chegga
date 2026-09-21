// Chegga Web — fetch a visitor's newest games from Chess.com or Lichess
//
// One DOM-free entry point for "get this person's latest games into
// IndexedDB", used by the first-run tutorial and by the Get started form.
// Chess.com goes through the existing month-by-month sync (unchanged);
// Lichess has no monthly archives, so its games come as one request for the
// newest N, and a re-sync asks only for games newer than the newest one
// already stored.
//
// Every failure a visitor can cause (a misspelled name, an empty account, a
// rate limit) is thrown as a SiteSyncError whose message is written for them.

import { ChessComClient, ChessComHttpError } from "./chessComClient";
import { quickSyncRecentGames } from "./syncService";
import { fetchLichessGames, LichessHttpError } from "./lichessClient";
import { normalizeLichessGame, LICHESS_ID_PREFIX } from "./lichessNormalizer";
import { gameExists, getGamesByUsername, getSyncState, putGame, putSyncState } from "./db";

export type Site = "chesscom" | "lichess";

export const SITE_NAMES: Record<Site, string> = { chesscom: "Chess.com", lichess: "Lichess" };

const LAST_SITE_KEY = "chegga-web:last-site";

export class SiteSyncError extends Error {}

export interface SiteSyncResult {
  gamesAdded: number;
  /** false when the account has more games than were fetched */
  fullyCaughtUp: boolean;
}

export interface SiteSyncProgress {
  text: string;
  done?: number;
  total?: number;
}

// Both sites: letters, digits, "_" and "-". Lichess allows 2-20, Chess.com
// 3-25; this only rejects what neither site could have, so a real name is
// never refused and nothing odd reaches a URL.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;

/** `null` when the name is usable, otherwise a sentence for the visitor. */
export function usernameProblem(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Type your username first.";
  if (!USERNAME_RE.test(name)) return "Usernames use letters, numbers, - and _ only. Check for spaces or an email address.";
  return null;
}

export function getLastSite(): Site {
  try {
    return localStorage.getItem(LAST_SITE_KEY) === "lichess" ? "lichess" : "chesscom";
  } catch {
    return "chesscom";
  }
}

export function setLastSite(site: Site): void {
  try {
    localStorage.setItem(LAST_SITE_KEY, site);
  } catch {
    // best-effort only, like the remembered username
  }
}

async function syncChessCom(
  db: IDBDatabase,
  username: string,
  target: number,
  onProgress?: (p: SiteSyncProgress) => void,
): Promise<SiteSyncResult> {
  const client = new ChessComClient(`chegga-web visitor sync for ${username}`);
  try {
    const result = await quickSyncRecentGames(db, client, username, target, (p) =>
      onProgress?.({ text: `Reading ${p.currentMonth ?? "your games"}…`, done: p.monthsProcessed, total: p.totalMonths }),
    );
    return { gamesAdded: result.gamesAdded, fullyCaughtUp: result.fullyCaughtUp };
  } catch (err) {
    if (err instanceof ChessComHttpError) {
      if (err.status === 404) {
        throw new SiteSyncError(`Chess.com has no account named "${username}". Check the spelling and try again.`);
      }
      throw new SiteSyncError(`Chess.com could not be reached (error ${err.status}). Try again in a moment.`);
    }
    throw new SiteSyncError("Could not reach Chess.com. Check your connection and try again.");
  }
}

/** `incremental` asks Lichess only for games newer than the newest stored. */
export async function syncLichess(
  db: IDBDatabase,
  username: string,
  opts: { max: number; incremental?: boolean },
  fetchImpl?: typeof fetch,
): Promise<SiteSyncResult> {
  let sinceMs: number | undefined;
  if (opts.incremental) {
    const mine = (await getGamesByUsername(db, username)).filter((g) => g.chessComUuid.startsWith(LICHESS_ID_PREFIX));
    if (mine.length) sinceMs = Math.max(...mine.map((g) => g.endTime)) * 1000 + 1;
  }

  let raws;
  try {
    raws = await fetchLichessGames(username, { max: opts.max, sinceMs }, fetchImpl);
  } catch (err) {
    if (err instanceof LichessHttpError) throw new SiteSyncError(err.message);
    throw err;
  }

  let gamesAdded = 0;
  for (const raw of raws) {
    const record = normalizeLichessGame(raw, username);
    if (!record || (await gameExists(db, record.chessComUuid))) continue;
    await putGame(db, record);
    gamesAdded += 1;
  }

  const fullyCaughtUp = raws.length < opts.max;
  const before = await getSyncState(db, username, "lichess");
  await putSyncState(db, {
    username,
    yearMonth: "lichess", // Lichess has no month archives; one row says "this account has been synced"
    status: fullyCaughtUp ? "complete" : "partial",
    gamesFetched: (before?.gamesFetched ?? 0) + gamesAdded,
    lastSyncedAt: Date.now(),
  });
  return { gamesAdded, fullyCaughtUp };
}

/** Newest-first sync of about `target` games from either site. */
export async function syncRecentGames(
  db: IDBDatabase,
  site: Site,
  username: string,
  target: number,
  onProgress?: (p: SiteSyncProgress) => void,
): Promise<SiteSyncResult> {
  if (site === "lichess") {
    onProgress?.({ text: "Asking Lichess for your newest games…" });
    return syncLichess(db, username, { max: target, incremental: false });
  }
  return syncChessCom(db, username, target, onProgress);
}
