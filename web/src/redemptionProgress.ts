// Chegga Web — redemption checklist state (spine addition B)
//
// The "replay your loss" list is compiled live from the same blunder/
// mistake moves extractPuzzles() already pulls from analyzed games -- no
// new store. Only the redeemed-state is persisted here, per-viewer, same
// localStorage tier as puzzleProgress.

const KEY = "chegga-web:redemptions:";

interface RedemptionEntry {
  redeemedAt: number;
}
type RedemptionMap = Record<string, RedemptionEntry>;

function load(user: string): RedemptionMap {
  try {
    const raw = localStorage.getItem(KEY + user);
    return raw ? (JSON.parse(raw) as RedemptionMap) : {};
  } catch {
    return {};
  }
}

function save(user: string, map: RedemptionMap): void {
  try {
    localStorage.setItem(KEY + user, JSON.stringify(map));
  } catch {
    // best-effort only
  }
}

export function isRedeemed(user: string, id: string): boolean {
  return !!load(user)[id];
}

export function markRedeemed(user: string, id: string): void {
  const map = load(user);
  if (map[id]) return;
  map[id] = { redeemedAt: Date.now() };
  save(user, map);
}

export function redeemedCount(user: string): number {
  return Object.keys(load(user)).length;
}
