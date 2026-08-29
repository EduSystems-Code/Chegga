// Chegga Web — personal puzzle rating (spine addition A)
//
// An Elo-style number that moves on every themed-puzzle result against
// that puzzle's real Lichess rating (which is in the bundled data). K
// decays as you solve more, so it's volatile early and stable later --
// the poor-man's version of Glicko's rating deviation. Per-viewer
// convenience state, same localStorage tier as puzzleProgress / the
// remembered username -- not synced, not load-bearing.

const KEY = "chegga-web:puzzle-rating:";

export interface RatingState {
  rating: number;
  solved: number; // total attempts that counted toward the rating
  seeded: boolean; // whether an explicit seed has been applied
  history: number[]; // trailing ratings for the sparkline (most recent last)
}

const DEFAULT: RatingState = { rating: 1000, solved: 0, seeded: false, history: [] };
const HISTORY_CAP = 60;
const MIN_RATING = 400;
const MAX_RATING = 3000;

function load(user: string): RatingState {
  try {
    const raw = localStorage.getItem(KEY + user);
    if (!raw) return { ...DEFAULT };
    const parsed = JSON.parse(raw) as Partial<RatingState>;
    return {
      rating: typeof parsed.rating === "number" ? parsed.rating : DEFAULT.rating,
      solved: parsed.solved ?? 0,
      seeded: parsed.seeded ?? false,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_CAP) : [],
    };
  } catch {
    return { ...DEFAULT };
  }
}

function save(user: string, state: RatingState): void {
  try {
    localStorage.setItem(KEY + user, JSON.stringify(state));
  } catch {
    // best-effort only
  }
}

export function getRating(user: string): RatingState {
  return load(user);
}

/** One-time seed (e.g. from the visitor's Chess.com blitz rating). No-op
 * once anything has been seeded or any puzzle has counted -- so a later
 * re-sync can't yank the rating around after the player has built real
 * history. */
export function seedRating(user: string, seed: number): void {
  const state = load(user);
  if (state.seeded || state.solved > 0) return;
  const clamped = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(seed)));
  save(user, { ...state, rating: clamped, seeded: true, history: [clamped] });
}

function kFactor(solved: number): number {
  if (solved < 20) return 40;
  if (solved < 60) return 24;
  if (solved < 150) return 16;
  return 10;
}

function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** Applies one puzzle result and returns the new state. `solved` true =
 * the whole line was found, false = a wrong move ended it. */
export function applyResult(user: string, puzzleRating: number, solved: boolean): RatingState {
  const state = load(user);
  const k = kFactor(state.solved);
  const exp = expectedScore(state.rating, puzzleRating);
  const next = state.rating + k * ((solved ? 1 : 0) - exp);
  const rating = Math.max(MIN_RATING, Math.min(MAX_RATING, Math.round(next)));
  const history = [...state.history, rating].slice(-HISTORY_CAP);
  const updated: RatingState = { rating, solved: state.solved + 1, seeded: state.seeded, history };
  save(user, updated);
  return updated;
}

/** Tiny inline SVG sparkline of the trailing history. Empty string when
 * there's not enough history to draw a line. */
export function ratingSparkline(history: number[], w = 120, h = 28): string {
  if (history.length < 2) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(1, max - min);
  const step = w / (history.length - 1);
  const pts = history
    .map((r, i) => `${(i * step).toFixed(1)},${(h - ((r - min) / range) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  const rising = history[history.length - 1] >= history[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="vertical-align:middle">
    <polyline points="${pts}" fill="none" stroke="${rising ? "#4ade80" : "#f2555a"}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}
