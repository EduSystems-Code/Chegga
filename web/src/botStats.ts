// Chegga Web — minimal record of bot-game outcomes, just enough to feed
// achievements ("beat the bot at 1600 Elo"). Per-viewer localStorage.

const KEY = "chegga-web:bot-stats:";

interface BotStats {
  wins: number;
  losses: number;
  draws: number;
  bestWinElo: number;
}

function load(user: string): BotStats {
  try {
    const raw = localStorage.getItem(KEY + user);
    return raw ? (JSON.parse(raw) as BotStats) : { wins: 0, losses: 0, draws: 0, bestWinElo: 0 };
  } catch {
    return { wins: 0, losses: 0, draws: 0, bestWinElo: 0 };
  }
}

export function recordBotResult(user: string, elo: number, result: "win" | "loss" | "draw"): void {
  const s = load(user);
  if (result === "win") {
    s.wins += 1;
    if (elo > s.bestWinElo) s.bestWinElo = elo;
  } else if (result === "loss") {
    s.losses += 1;
  } else {
    s.draws += 1;
  }
  try {
    localStorage.setItem(KEY + user, JSON.stringify(s));
  } catch {
    // best-effort only
  }
}

export function bestWinElo(user: string): number {
  return load(user).bestWinElo;
}
