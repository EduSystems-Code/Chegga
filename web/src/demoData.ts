// Chegga Web — the bundled demo dataset.
//
// Before this existed, a first-time visitor saw an empty page: every card
// hides itself until there is data, and there is no data until you hand over
// a real username and wait out a sync plus an engine run. "See a demo" fills
// that gap with a fabricated player's already-analyzed history so the app can
// be judged in one click.
//
// The fixture is a static asset (public/demo-data.json, built by
// scripts/generate-demo-data.mjs) in exactly the shape `exportAllData`
// produces, so it loads through `importAllData` — the same path a real backup
// restore uses. Nothing here is a second way to write games into IndexedDB.
//
// It is stored under its own username, which is what makes it cleanly
// removable: "clear" deletes every row keyed to that visitor and every
// localStorage key that names them, leaving a real account's data untouched
// if the visitor had already synced one.

import { importAllData, type ExportedData } from "./db";

export const DEMO_USERNAME = "chegga-demo";

const DEMO_FLAG_KEY = "chegga-web:demo-active";
const BUNDLE_URL = `${import.meta.env.BASE_URL}demo-data.json`;

export function isDemoActive(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG_KEY) === "1";
  } catch {
    return false; // blocked storage — treat as "no demo loaded"
  }
}

function setDemoFlag(active: boolean): void {
  try {
    if (active) localStorage.setItem(DEMO_FLAG_KEY, "1");
    else localStorage.removeItem(DEMO_FLAG_KEY);
  } catch {
    // best-effort only, like every other remembered preference here
  }
}

/** Fetches the bundled fixture and upserts it through the normal import
 * path. Safe to call twice — `importAllData` upserts by key. */
export async function loadDemoData(db: IDBDatabase): Promise<{ games: number; moveAnalysis: number }> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the demo data (${res.status}).`);
  const data = (await res.json()) as ExportedData;
  const result = await importAllData(db, data);
  setDemoFlag(true);
  return { games: result.games, moveAnalysis: result.moveAnalysis };
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function keysFromIndex(store: IDBObjectStore, indexName: string, value: string): Promise<IDBValidKey[]> {
  return new Promise((resolve, reject) => {
    const request = store.index(indexName).getAllKeys(IDBKeyRange.only(value));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const USER_KEYED_STORES = ["syncState", "skillSnapshots", "rivalSnapshots", "savedPuzzles"];

/** Removes every trace of the demo visitor — the username-keyed stores, the
 * move analyses belonging to their games, and any localStorage progress saved
 * against their name. A real synced account is untouched.
 *
 * Keys are collected in a readonly transaction and deleted in a second,
 * write-only one: awaiting a request mid-transaction risks the transaction
 * going inactive before the deletes are issued. */
export async function clearDemoData(db: IDBDatabase): Promise<void> {
  const readTx = db.transaction(["games", "moveAnalysis", ...USER_KEYED_STORES], "readonly");
  const gameIds = (await keysFromIndex(readTx.objectStore("games"), "byUsername", DEMO_USERNAME)) as string[];
  // moveAnalysis is keyed [gameId, ply] and has no username of its own, so it
  // is cleared via its byGameId index rather than a full-store scan.
  const moveKeys: IDBValidKey[] = [];
  for (const gameId of gameIds) {
    moveKeys.push(...(await keysFromIndex(readTx.objectStore("moveAnalysis"), "byGameId", gameId)));
  }
  const userKeys = new Map<string, IDBValidKey[]>();
  for (const storeName of USER_KEYED_STORES) {
    userKeys.set(storeName, await keysFromIndex(readTx.objectStore(storeName), "byUsername", DEMO_USERNAME));
  }

  const tx = db.transaction(["games", "moveAnalysis", ...USER_KEYED_STORES], "readwrite");
  for (const id of gameIds) tx.objectStore("games").delete(id);
  for (const key of moveKeys) tx.objectStore("moveAnalysis").delete(key);
  for (const [storeName, keys] of userKeys) {
    for (const key of keys) tx.objectStore(storeName).delete(key);
  }

  await done(tx);

  try {
    // Every per-visitor key is `<prefix>:<username>`, so the demo's puzzle
    // progress, streaks, ratings and redemptions all carry its name.
    const stale = Object.keys(localStorage).filter((k) => k.includes(DEMO_USERNAME));
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // blocked storage — nothing was written there either
  }
  setDemoFlag(false);
}
