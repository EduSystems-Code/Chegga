// Chegga Web — save/resume an in-progress "Play vs. bot" game
//
// chess.js's own `pgn()` already embeds a [FEN]/[SetUp] header when the
// game didn't start from the standard position (confirmed: removing a
// piece then calling `.pgn()` round-trips correctly through `loadPgn`),
// so the PGN alone is enough to reconstruct an odds game or a drill, not
// just a normal game — no separate "start FEN" field needed.

const STORAGE_KEY = "chegga-web:bot-game-in-progress";

export interface SavedBotGame {
  pgn: string;
  humanColor: "white" | "black";
  elo: number;
  savedAt: number;
}

export function saveBotGame(game: SavedBotGame): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  } catch {
    // ignore -- best-effort only
  }
}

export function loadSavedBotGame(): SavedBotGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedBotGame) : null;
  } catch {
    return null;
  }
}

export function clearSavedBotGame(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
