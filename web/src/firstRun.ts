// Chegga Web — is this someone's first visit?
//
// The web app has no install step, so "first time" means: this browser has
// never used it. The check runs once, at the very top of main.ts, BEFORE the
// app writes anything of its own (the board theme and a few other settings
// are written on every load, so they say nothing about the visitor).
//
// A visitor counts as returning if the browser holds any sign they DID
// something: a remembered username, a bot game, saved progress, a card they
// opened or closed. Finishing or skipping the tutorial writes its own key so
// it is never shown twice.

export const TUTORIAL_KEY = "chegga-web:tutorial";

export type TutorialState = "done" | "skipped";

const ACTIVITY_KEYS = [
  "chegga-web:last-username",
  "chegga-web:bot-game-in-progress",
  "chegga-web:card-collapsed:",
  "chegga-web:bot-stats:",
  "chegga-web:puzzle-progress:",
  "chegga-web:puzzle-streak:",
  "chegga-web:redemptions:",
];

interface StorageLike {
  getItem(key: string): string | null;
  key(index: number): string | null;
  readonly length: number;
}

export interface FirstRunEnv {
  storage: StorageLike | null;
  search: string; // location.search
  hashUsername?: string; // the `u` in `#u=name`, a shared link that already names an account
}

/** `?tutorial=1` always shows it (a "replay" link, and tests); `?tutorial=0`
 * never does. Blocked storage means "do not show": with nowhere to remember
 * the choice, it would come back on every visit. */
export function shouldShowTutorial(env: FirstRunEnv): boolean {
  const query = new URLSearchParams(env.search).get("tutorial");
  if (query === "1") return true;
  if (query === "0") return false;
  if (!env.storage) return false;
  try {
    if (env.storage.getItem(TUTORIAL_KEY)) return false;
    if (env.hashUsername) return false;
    for (let i = 0; i < env.storage.length; i++) {
      const key = env.storage.key(i);
      if (key && ACTIVITY_KEYS.some((prefix) => key.startsWith(prefix))) return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function markTutorial(state: TutorialState): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, state);
  } catch {
    // best-effort only, like every other remembered preference here
  }
}
