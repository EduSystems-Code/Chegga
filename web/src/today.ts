// Chegga Web — "Today" daily session (spine addition C)
//
// One regimented set per local day: a few themed puzzles aimed at the
// visitor's weakest area, a couple of spaced-repetition reviews, and one
// "redeem a past loss". A clear completion point that feeds a Today
// streak -- players can keep training past it, nothing is gated. State is
// per-viewer localStorage, same tier as the rest of the progress data;
// the set is stable across reloads within a day and regenerates at local
// midnight.

const KEY = "chegga-web:today:";
const STREAK_KEY = "chegga-web:today-streak:";

export type TodayKind = "themed" | "review" | "redemption";

export interface TodayItem {
  kind: TodayKind;
  label: string;
  target: number;
  done: number;
  // themed only -- the spec a "Start" button needs to configure the
  // themed-puzzle card so the session actually practises the right thing.
  themes?: string[];
  ratingMin?: number;
  ratingMax?: number;
}

export interface TodayState {
  date: string; // YYYY-MM-DD local
  items: TodayItem[];
  streakCounted: boolean; // guards the Today streak against double-counting on reload
}

export interface TodayStreak {
  current: number;
  best: number;
  lastCompletedDate: string;
}

export function todayLocalDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86_400_000);
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
    // best-effort only
  }
}

export interface BuildTodayInput {
  focusThemes: string[]; // weakest-area themes (from skillProfile -> pkPuzzleMap), may be empty
  ratingMin: number;
  ratingMax: number;
  hasAnalyzedGames: boolean;
  dueReviewCount: number;
  unredeemedCount: number;
}

export function buildToday(input: BuildTodayInput): TodayState {
  const themes = input.focusThemes.length ? input.focusThemes : ["fork", "pin", "hangingPiece"];
  const themedLabel = input.focusThemes.length
    ? `${input.focusThemes.length === 1 ? "Theme" : "Themes"}: ${input.focusThemes.join(", ")}`
    : "Mixed tactics";

  const items: TodayItem[] = [];

  if (input.hasAnalyzedGames) {
    items.push({ kind: "themed", label: `3 themed puzzles — ${themedLabel}`, target: 3, done: 0, themes, ratingMin: input.ratingMin, ratingMax: input.ratingMax });
    if (input.dueReviewCount > 0) {
      const t = Math.min(2, input.dueReviewCount);
      items.push({ kind: "review", label: `${t} spaced-repetition review${t > 1 ? "s" : ""} from your own blunders`, target: t, done: 0 });
    }
    if (input.unredeemedCount > 0) {
      items.push({ kind: "redemption", label: "Redeem 1 past loss", target: 1, done: 0 });
    }
  } else {
    items.push({ kind: "themed", label: `5 themed puzzles — ${themedLabel}`, target: 5, done: 0, themes, ratingMin: input.ratingMin, ratingMax: input.ratingMax });
  }

  return { date: todayLocalDate(), items, streakCounted: false };
}

/** Returns today's set if one exists for the current local date, else
 * null (caller should build + save a fresh one). */
export function getToday(user: string): TodayState | null {
  const state = loadJson<TodayState | null>(KEY + user, null);
  if (!state || state.date !== todayLocalDate()) return null;
  return state;
}

export function saveToday(user: string, state: TodayState): void {
  saveJson(KEY + user, state);
}

/** Increments progress for the first not-yet-complete item of `kind`.
 * No-op if there's no such item or it's already at target. Returns the
 * updated state (or null if there's no set for today). */
export function bumpToday(user: string, kind: TodayKind): TodayState | null {
  const state = getToday(user);
  if (!state) return null;
  const item = state.items.find((i) => i.kind === kind && i.done < i.target);
  if (!item) return state;
  item.done += 1;
  saveToday(user, state);
  return state;
}

export function isTodayComplete(state: TodayState): boolean {
  return state.items.length > 0 && state.items.every((i) => i.done >= i.target);
}

export function getTodayStreak(user: string): TodayStreak {
  return loadJson<TodayStreak>(STREAK_KEY + user, { current: 0, best: 0, lastCompletedDate: "" });
}

/** Call exactly once when today's set first reaches complete -- guarded
 * by TodayState.streakCounted so a reload can't double-count. */
export function recordTodayComplete(user: string): TodayStreak {
  const streak = getTodayStreak(user);
  const today = todayLocalDate();
  if (streak.lastCompletedDate === today) return streak;
  const gap = streak.lastCompletedDate ? daysBetween(streak.lastCompletedDate, today) : null;
  const current = gap === 1 ? streak.current + 1 : 1;
  const next: TodayStreak = { current, best: Math.max(streak.best, current), lastCompletedDate: today };
  saveJson(STREAK_KEY + user, next);
  return next;
}
