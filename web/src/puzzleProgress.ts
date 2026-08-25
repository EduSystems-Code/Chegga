// Chegga Web — puzzle solved-state + daily streak, localStorage-backed
//
// Per-viewer convenience state, same tier as the remembered username in
// main.ts — not synced anywhere, not load-bearing data, just "don't make
// me re-solve puzzles I already got" and a streak counter for the daily
// habit loop. Wrapped in try/catch throughout: private browsing or
// blocked storage should degrade to "no memory," never throw.

const PROGRESS_KEY_PREFIX = "chegga-web:puzzle-progress:";
const STREAK_KEY_PREFIX = "chegga-web:puzzle-streak:";

interface PuzzleProgressEntry {
  solved: boolean;
  attempts: number;
  lastAttemptAt: number;
}

type ProgressMap = Record<string, PuzzleProgressEntry>;

interface StreakState {
  lastSolvedDate: string; // "YYYY-MM-DD", local date
  currentStreak: number;
  bestStreak: number;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore -- best-effort only
  }
}

function todayLocalDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function getProgress(username: string): ProgressMap {
  return loadJson(PROGRESS_KEY_PREFIX + username, {});
}

export function isSolved(username: string, puzzleId: string): boolean {
  return getProgress(username)[puzzleId]?.solved ?? false;
}

/** Records an attempt; only flips a puzzle to solved on success, never
 * back to unsolved (a later wrong retry on an already-solved puzzle
 * doesn't un-solve it — the point is "have you ever gotten this right,"
 * not "did you get it right just now"). */
export function recordAttempt(username: string, puzzleId: string, correct: boolean): void {
  const progress = getProgress(username);
  const existing = progress[puzzleId] ?? { solved: false, attempts: 0, lastAttemptAt: 0 };
  progress[puzzleId] = {
    solved: existing.solved || correct,
    attempts: existing.attempts + 1,
    lastAttemptAt: Date.now(),
  };
  saveJson(PROGRESS_KEY_PREFIX + username, progress);
  if (correct) bumpStreak(username);
}

export function getStreak(username: string): StreakState {
  return loadJson(STREAK_KEY_PREFIX + username, { lastSolvedDate: "", currentStreak: 0, bestStreak: 0 });
}

function bumpStreak(username: string): void {
  const state = getStreak(username);
  const today = todayLocalDate();

  if (state.lastSolvedDate === today) {
    // Already counted today -- solving a second puzzle doesn't double-count.
    return;
  }

  const gap = state.lastSolvedDate ? daysBetween(state.lastSolvedDate, today) : null;
  const currentStreak = gap === 1 ? state.currentStreak + 1 : 1; // consecutive day continues it, any gap resets to 1
  const bestStreak = Math.max(state.bestStreak, currentStreak);

  saveJson(STREAK_KEY_PREFIX + username, { lastSolvedDate: today, currentStreak, bestStreak });
}
