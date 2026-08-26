// Chegga Web — IndexedDB schema (Phase 0)
//
// Mirrors Chegga's real backend models 1:1 as object stores, per the
// phase plan (projects/chegga-web/phase-plan.md in the my-brain vault):
//   - games          <- app/models/game.py's Game, keyed by chess_com_uuid
//   - moveAnalysis    <- app/models/move_analysis.py's MoveAnalysis, keyed by (game_id, ply)
//   - syncState       <- app/models/sync_state.py's SyncState, keyed by (username, year_month)
//
// No coachingReport store in v1 — coaching stays parked (see context.md).

const DB_NAME = "chegga-web";
// v2 adds `skillSnapshots` (the growth-path feature's progress-over-time
// store) -- onupgradeneeded only adds what's missing, so a real v1
// browser DB upgrades in place without losing its existing games/
// moveAnalysis/syncState data.
const DB_VERSION = 2;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("games")) {
        const games = db.createObjectStore("games", { keyPath: "chessComUuid" });
        games.createIndex("byUsername", "username", { unique: false });
        games.createIndex("byEndTime", "endTime", { unique: false });
      }

      if (!db.objectStoreNames.contains("moveAnalysis")) {
        // Composite key (gameId, ply) as a stored array field — IndexedDB
        // keyPath arrays let us key on both without a synthetic id.
        const moveAnalysis = db.createObjectStore("moveAnalysis", {
          keyPath: ["gameId", "ply"],
        });
        moveAnalysis.createIndex("byGameId", "gameId", { unique: false });
      }

      if (!db.objectStoreNames.contains("syncState")) {
        const syncState = db.createObjectStore("syncState", {
          keyPath: ["username", "yearMonth"],
        });
        syncState.createIndex("byUsername", "username", { unique: false });
      }

      if (!db.objectStoreNames.contains("skillSnapshots")) {
        const skillSnapshots = db.createObjectStore("skillSnapshots", {
          keyPath: ["username", "dateStamp"], // one snapshot per calendar day per visitor
        });
        skillSnapshots.createIndex("byUsername", "username", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// --- Types (fields mirror the Python models; camelCase per JS convention) ---

export interface GameRecord {
  chessComUuid: string;
  username: string; // the tracked/synced visitor username (not on the backend Game model, but IndexedDB has no per-user table separation)
  url: string;
  pgn: string;
  timeControl: string;
  timeClass: string;
  rules: string;
  rated: boolean;
  endTime: number; // unix seconds
  eco?: string;
  openingName?: string;
  whiteUsername: string;
  whiteRating: number;
  blackUsername: string;
  blackRating: number;
  whiteResult: string; // chess.com's raw per-side code, e.g. "win" | "checkmated" | "resigned"
  blackResult: string;
  userColor: "white" | "black";
  userResult: "win" | "loss" | "draw";
  analyzed: boolean;
}

export interface MoveAnalysisRecord {
  gameId: string; // chessComUuid
  ply: number; // 1-indexed half-move number
  sideToMove: "white" | "black"; // who made this move

  fenBefore: string;
  san: string;
  uci: string;

  // White-relative centipawns/mate, matching the backend model's own
  // convention (keeps an eval-over-time chart continuous instead of
  // flipping sign every ply). Centipawn loss is computed from the mover's
  // perspective at compute time, not stored that way.
  evalBeforeCp?: number;
  evalBeforeMate?: number;
  evalAfterCp?: number;
  evalAfterMate?: number;

  bestMoveUci?: string;
  bestMoveSan?: string;

  centipawnLoss: number;
  moveRank?: number; // undefined = outside the analyzed top N (MultiPV)

  classification: string; // best/excellent/good/inaccuracy/mistake/blunder
  gamePhase: "opening" | "middlegame" | "endgame";

  blunderTag?: string; // hung_material | missed_mate | allowed_mate | missed_capture | positional

  clockSeconds?: number;
  timePressureBand?: string;
}

export interface SkillSnapshotRecord {
  username: string;
  dateStamp: string; // "YYYY-MM-DD", local calendar day — one per day per visitor
  timestamp: number; // unix ms, for ordering/display
  scores: Record<string, number>; // skillProfile.ts's SKILL_CATEGORIES ids -> 0-100
  weakestCategory?: string;
  gamesAnalyzed: number;
}

export interface SyncStateRecord {
  username: string;
  yearMonth: string; // "YYYY-MM"
  status: "partial" | "complete";
  gamesFetched: number;
  lastSyncedAt: number; // unix ms
}

// --- Store helpers (Phase 1: sync) ---

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getSyncState(
  db: IDBDatabase,
  username: string,
  yearMonth: string,
): Promise<SyncStateRecord | undefined> {
  const tx = db.transaction("syncState", "readonly");
  return req(tx.objectStore("syncState").get([username, yearMonth]));
}

export function putSyncState(db: IDBDatabase, state: SyncStateRecord): Promise<void> {
  const tx = db.transaction("syncState", "readwrite");
  tx.objectStore("syncState").put(state);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** How many months already have a sync record for this visitor -- used
 * purely for the "resuming, N months already synced" message shown
 * before a sync run starts, not for any resume logic itself (that
 * already lives in syncGames, keyed the same way). */
export function countSyncStatesForUsername(db: IDBDatabase, username: string): Promise<number> {
  const tx = db.transaction("syncState", "readonly");
  const index = tx.objectStore("syncState").index("byUsername");
  return req(index.getAll(IDBKeyRange.only(username))).then((rows) => rows.length);
}

export function gameExists(db: IDBDatabase, chessComUuid: string): Promise<boolean> {
  const tx = db.transaction("games", "readonly");
  return req(tx.objectStore("games").getKey(chessComUuid)).then((key) => key !== undefined);
}

export function putGame(db: IDBDatabase, game: GameRecord): Promise<void> {
  const tx = db.transaction("games", "readwrite");
  tx.objectStore("games").put(game);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function countGamesByUsername(db: IDBDatabase, username: string): Promise<number> {
  const tx = db.transaction("games", "readonly");
  const index = tx.objectStore("games").index("byUsername");
  return req(index.count(IDBKeyRange.only(username)));
}

export function getGame(db: IDBDatabase, chessComUuid: string): Promise<GameRecord | undefined> {
  const tx = db.transaction("games", "readonly");
  return req(tx.objectStore("games").get(chessComUuid));
}

export function markGameAnalyzed(db: IDBDatabase, game: GameRecord): Promise<void> {
  return putGame(db, { ...game, analyzed: true });
}

// --- Store helpers (Phase 2: engine analysis) ---

export function putMoveAnalyses(db: IDBDatabase, moves: MoveAnalysisRecord[]): Promise<void> {
  const tx = db.transaction("moveAnalysis", "readwrite");
  const store = tx.objectStore("moveAnalysis");
  for (const move of moves) store.put(move);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getMoveAnalysesForGame(db: IDBDatabase, gameId: string): Promise<MoveAnalysisRecord[]> {
  const tx = db.transaction("moveAnalysis", "readonly");
  const index = tx.objectStore("moveAnalysis").index("byGameId");
  return req(index.getAll(IDBKeyRange.only(gameId)));
}

// --- Store helpers (Phase 3: profile/pattern stats) ---

export function getGamesByUsername(db: IDBDatabase, username: string): Promise<GameRecord[]> {
  const tx = db.transaction("games", "readonly");
  const index = tx.objectStore("games").index("byUsername");
  return req(index.getAll(IDBKeyRange.only(username)));
}

/** Naive full-store scan, filtered to the given game ids in memory — per
 * the phase plan, per-visitor game counts are expected to be far below
 * Chegga's own 21k-game backlog, so this is fine without a SQL-in-the-
 * browser layer unless profiling says otherwise. */
export function getMoveAnalysesForGames(db: IDBDatabase, gameIds: Set<string>): Promise<MoveAnalysisRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("moveAnalysis", "readonly");
    const store = tx.objectStore("moveAnalysis");
    const results: MoveAnalysisRecord[] = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      const record = cursor.value as MoveAnalysisRecord;
      if (gameIds.has(record.gameId)) results.push(record);
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// --- Store helpers (skill profile / growth-path snapshots) ---

export function putSkillSnapshot(db: IDBDatabase, snapshot: SkillSnapshotRecord): Promise<void> {
  const tx = db.transaction("skillSnapshots", "readwrite");
  tx.objectStore("skillSnapshots").put(snapshot);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getSkillSnapshots(db: IDBDatabase, username: string): Promise<SkillSnapshotRecord[]> {
  const tx = db.transaction("skillSnapshots", "readonly");
  const index = tx.objectStore("skillSnapshots").index("byUsername");
  return req(index.getAll(IDBKeyRange.only(username))).then((rows) => rows.sort((a, b) => a.timestamp - b.timestamp));
}

// --- Store helpers (export/import — a visitor's only copy of their data
// lives in this one browser's IndexedDB; this is the escape hatch so
// switching browsers/devices or clearing site data doesn't silently lose
// hours of in-browser Stockfish analysis) ---

export interface ExportedData {
  formatVersion: 1 | 2;
  exportedAt: number; // unix ms
  games: GameRecord[];
  moveAnalysis: MoveAnalysisRecord[];
  syncState: SyncStateRecord[];
  skillSnapshots?: SkillSnapshotRecord[]; // absent on a v1 export -- treated as empty on import
}

function getAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  const tx = db.transaction(storeName, "readonly");
  return req(tx.objectStore(storeName).getAll());
}

export async function exportAllData(db: IDBDatabase): Promise<ExportedData> {
  const [games, moveAnalysis, syncState, skillSnapshots] = await Promise.all([
    getAll<GameRecord>(db, "games"),
    getAll<MoveAnalysisRecord>(db, "moveAnalysis"),
    getAll<SyncStateRecord>(db, "syncState"),
    getAll<SkillSnapshotRecord>(db, "skillSnapshots"),
  ]);
  return { formatVersion: 2, exportedAt: Date.now(), games, moveAnalysis, syncState, skillSnapshots };
}

/** Upserts every record from `data` into the current DB — safe to run
 * against a DB that already has some overlapping games (same upsert-by-key
 * semantics as sync), so importing into a browser that already has partial
 * data merges rather than duplicating or erroring. Accepts both a v1
 * export (no skillSnapshots field -- older backups shouldn't become
 * unreadable just because a new store was added later) and v2. */
export async function importAllData(
  db: IDBDatabase,
  data: ExportedData,
): Promise<{ games: number; moveAnalysis: number; syncState: number; skillSnapshots: number }> {
  if (data.formatVersion !== 1 && data.formatVersion !== 2) {
    throw new Error(`Unsupported export format version: ${(data as any).formatVersion}`);
  }
  const snapshots = data.skillSnapshots ?? [];
  const tx = db.transaction(["games", "moveAnalysis", "syncState", "skillSnapshots"], "readwrite");
  const gamesStore = tx.objectStore("games");
  const moveStore = tx.objectStore("moveAnalysis");
  const syncStore = tx.objectStore("syncState");
  const skillStore = tx.objectStore("skillSnapshots");
  for (const g of data.games) gamesStore.put(g);
  for (const m of data.moveAnalysis) moveStore.put(m);
  for (const s of data.syncState) syncStore.put(s);
  for (const s of snapshots) skillStore.put(s);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return { games: data.games.length, moveAnalysis: data.moveAnalysis.length, syncState: data.syncState.length, skillSnapshots: snapshots.length };
}
