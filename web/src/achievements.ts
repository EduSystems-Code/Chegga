// Chegga Web — achievements / badges (spine addition D)
//
// Makes accumulated effort visible: 400 analyzed games and 300 solved
// puzzles should not look the same as 4 and 3. Pure derived state -- each
// badge is a predicate over stats the other systems already track. The
// unlocked set is persisted per-viewer (localStorage); checkAchievements
// returns whichever ids newly flipped so the caller can toast them.

const KEY = "chegga-web:achievements:";

export interface AchievementStats {
  puzzlesSolved: number; // distinct blunder-puzzles ever solved
  themedSolved: number; // themed-library attempts that counted toward the rating
  puzzleRating: number;
  puzzleBestStreak: number; // best daily puzzle streak
  redeemed: number;
  gamesAnalyzed: number;
  gamesSynced: number;
  todayStreakBest: number;
  botBestWinElo: number; // highest bot Elo the player has beaten (0 = none)
}

export interface Achievement {
  id: string;
  label: string;
  description: string;
  test: (s: AchievementStats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-blood", label: "First Blood", description: "Solve your first puzzle", test: (s) => s.puzzlesSolved + s.themedSolved >= 1 },
  { id: "puzzle-25", label: "Warmed Up", description: "Solve 25 puzzles", test: (s) => s.puzzlesSolved + s.themedSolved >= 25 },
  { id: "puzzle-100", label: "Century", description: "Solve 100 puzzles", test: (s) => s.puzzlesSolved + s.themedSolved >= 100 },
  { id: "puzzle-500", label: "Tactician", description: "Solve 500 puzzles", test: (s) => s.puzzlesSolved + s.themedSolved >= 500 },
  { id: "rating-1200", label: "Climbing", description: "Reach a puzzle rating of 1200", test: (s) => s.puzzleRating >= 1200 },
  { id: "rating-1500", label: "Sharp", description: "Reach a puzzle rating of 1500", test: (s) => s.puzzleRating >= 1500 },
  { id: "rating-1800", label: "Dangerous", description: "Reach a puzzle rating of 1800", test: (s) => s.puzzleRating >= 1800 },
  { id: "rating-2100", label: "Feared", description: "Reach a puzzle rating of 2100", test: (s) => s.puzzleRating >= 2100 },
  { id: "streak-3", label: "Habit Forming", description: "3-day puzzle streak", test: (s) => s.puzzleBestStreak >= 3 },
  { id: "streak-7", label: "One Week Strong", description: "7-day puzzle streak", test: (s) => s.puzzleBestStreak >= 7 },
  { id: "streak-30", label: "Unbroken", description: "30-day puzzle streak", test: (s) => s.puzzleBestStreak >= 30 },
  { id: "today-7", label: "Routine", description: "Complete Today 7 days running", test: (s) => s.todayStreakBest >= 7 },
  { id: "today-30", label: "Discipline", description: "Complete Today 30 days running", test: (s) => s.todayStreakBest >= 30 },
  { id: "redeem-1", label: "Second Chance", description: "Redeem a past loss", test: (s) => s.redeemed >= 1 },
  { id: "redeem-10", label: "No Regrets", description: "Redeem 10 past losses", test: (s) => s.redeemed >= 10 },
  { id: "redeem-50", label: "Rewritten", description: "Redeem 50 past losses", test: (s) => s.redeemed >= 50 },
  { id: "analyze-50", label: "Looking Back", description: "Analyze 50 of your games", test: (s) => s.gamesAnalyzed >= 50 },
  { id: "analyze-250", label: "Self-Aware", description: "Analyze 250 of your games", test: (s) => s.gamesAnalyzed >= 250 },
  { id: "synced-1000", label: "Whole Story", description: "Sync 1,000 games", test: (s) => s.gamesSynced >= 1000 },
  { id: "bot-1200", label: "Sparring", description: "Beat the bot at 1200 Elo", test: (s) => s.botBestWinElo >= 1200 },
  { id: "bot-1600", label: "Contender", description: "Beat the bot at 1600 Elo", test: (s) => s.botBestWinElo >= 1600 },
  { id: "bot-2000", label: "Giant Killer", description: "Beat the bot at 2000 Elo", test: (s) => s.botBestWinElo >= 2000 },
];

function loadUnlocked(user: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY + user);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveUnlocked(user: string, set: Set<string>): void {
  try {
    localStorage.setItem(KEY + user, JSON.stringify([...set]));
  } catch {
    // best-effort only
  }
}

export function getUnlocked(user: string): Set<string> {
  return loadUnlocked(user);
}

/** Evaluates every badge against `stats`, persists any newly-earned ones,
 * and returns the newly-earned ids (empty array = nothing new). */
export function checkAchievements(user: string, stats: AchievementStats): string[] {
  const unlocked = loadUnlocked(user);
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!unlocked.has(a.id) && a.test(stats)) {
      unlocked.add(a.id);
      fresh.push(a.id);
    }
  }
  if (fresh.length) saveUnlocked(user, unlocked);
  return fresh;
}
