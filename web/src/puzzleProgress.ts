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
  // Leitner-style spaced repetition (critique #2): a solved puzzle isn't
  // gone forever -- it comes back after an interval that grows each time
  // you get it right and resets to 1 day when you get it wrong, so a
  // pattern you fluked once actually gets re-tested. Older entries saved
  // before this field existed are treated as box 0 / due now.
  box?: number;
  nextDueAt?: number;
}

// Days until a puzzle in each Leitner box comes due again.
const BOX_INTERVAL_DAYS = [1, 1, 3, 7, 21, 60];
const DAY_MS = 86_400_000;

function dueDelayForBox(box: number): number {
  const clamped = Math.max(1, Math.min(box, BOX_INTERVAL_DAYS.length - 1));
  return BOX_INTERVAL_DAYS[clamped] * DAY_MS;
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
  const existing = progress[puzzleId] ?? { solved: false, attempts: 0, lastAttemptAt: 0, box: 0 };
  const now = Date.now();
  // Right answer: advance a box (longer until it's due again). Wrong:
  // drop back to box 1 (due again in a day).
  const box = correct ? Math.min((existing.box ?? 0) + 1, BOX_INTERVAL_DAYS.length - 1) : 1;
  progress[puzzleId] = {
    solved: existing.solved || correct,
    attempts: existing.attempts + 1,
    lastAttemptAt: now,
    box,
    nextDueAt: now + dueDelayForBox(box),
  };
  saveJson(PROGRESS_KEY_PREFIX + username, progress);
  if (correct) bumpStreak(username);
}

/** A puzzle is "due" if it's never been attempted or its spaced-repetition
 * interval has elapsed -- these are what `pickPuzzle` should prefer, so a
 * practice session pulls in things actually worth re-testing rather than
 * only ever showing never-seen puzzles until those run out. */
export function isDue(username: string, puzzleId: string): boolean {
  const entry = getProgress(username)[puzzleId];
  if (!entry || entry.nextDueAt === undefined) return true;
  return entry.nextDueAt <= Date.now();
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
