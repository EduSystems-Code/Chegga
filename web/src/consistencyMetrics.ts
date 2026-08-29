// Chegga Web — consistency / tilt metrics
//
// At 2000-strength level, *when* you play badly matters as much as how
// often. Two patterns swing real rating: playing on after a loss, and
// playing too many games in one sitting. Both are measurable from synced
// game results alone (no engine analysis needed); blunder rate per slot
// is layered on where analyzed moves exist.

import type { GameRecord, MoveAnalysisRecord } from "./db";

const SESSION_GAP_SECONDS = 2 * 60 * 60; // >2h between games starts a new "session"

export interface SlotStat {
  label: string;
  games: number;
  winRate: number; // 0-1
  blundersPer100?: number; // undefined if no analyzed moves fall in this slot
}

export interface ConsistencySummary {
  baselineWinRate: number;
  afterLoss: SlotStat;
  afterWin: SlotStat;
  bySessionDepth: SlotStat[]; // "1st game", "2nd", "3rd", "4th+"
  longestLossStreak: number;
  recommendations: string[];
}

function winRate(games: GameRecord[]): number {
  if (games.length === 0) return 0;
  return games.filter((g) => g.userResult === "win").length / games.length;
}

function blundersPer100(games: GameRecord[], blunderCountByGame: Map<string, { moves: number; blunders: number }>): number | undefined {
  let moves = 0;
  let blunders = 0;
  for (const g of games) {
    const b = blunderCountByGame.get(g.chessComUuid);
    if (!b) continue;
    moves += b.moves;
    blunders += b.blunders;
  }
  if (moves < 30) return undefined;
  return Math.round((blunders / moves) * 1000) / 10;
}

export function computeConsistency(allGames: GameRecord[], ownMoves: MoveAnalysisRecord[]): ConsistencySummary | undefined {
  const rated = allGames.filter((g) => g.rated).sort((a, b) => a.endTime - b.endTime);
  if (rated.length < 10) return undefined;

  const blunderCountByGame = new Map<string, { moves: number; blunders: number }>();
  for (const m of ownMoves) {
    const b = blunderCountByGame.get(m.gameId) ?? { moves: 0, blunders: 0 };
    b.moves += 1;
    if (m.classification === "blunder") b.blunders += 1;
    blunderCountByGame.set(m.gameId, b);
  }

  const baselineWinRate = winRate(rated);

  const afterLossGames: GameRecord[] = [];
  const afterWinGames: GameRecord[] = [];
  for (let i = 1; i < rated.length; i++) {
    const prev = rated[i - 1];
    if (prev.endTime && rated[i].endTime - prev.endTime > SESSION_GAP_SECONDS * 3) continue; // "right after" only counts within the same play window (loose 6h)
    if (prev.userResult === "loss") afterLossGames.push(rated[i]);
    else if (prev.userResult === "win") afterWinGames.push(rated[i]);
  }

  // Session depth
  const depthBuckets: GameRecord[][] = [[], [], [], []]; // 1st, 2nd, 3rd, 4th+
  let depth = 0;
  let lastEnd = 0;
  for (const g of rated) {
    if (lastEnd && g.endTime - lastEnd > SESSION_GAP_SECONDS) depth = 0;
    const bucket = Math.min(depth, 3);
    depthBuckets[bucket].push(g);
    depth += 1;
    lastEnd = g.endTime;
  }
  const depthLabels = ["1st game of a session", "2nd game", "3rd game", "4th+ game"];
  const bySessionDepth: SlotStat[] = depthBuckets.map((games, i) => ({
    label: depthLabels[i],
    games: games.length,
    winRate: winRate(games),
    blundersPer100: blundersPer100(games, blunderCountByGame),
  }));

  // Longest loss streak
  let longestLossStreak = 0;
  let run = 0;
  for (const g of rated) {
    if (g.userResult === "loss") {
      run += 1;
      longestLossStreak = Math.max(longestLossStreak, run);
    } else run = 0;
  }

  const afterLoss: SlotStat = {
    label: "Game right after a loss",
    games: afterLossGames.length,
    winRate: winRate(afterLossGames),
    blundersPer100: blundersPer100(afterLossGames, blunderCountByGame),
  };
  const afterWin: SlotStat = {
    label: "Game right after a win",
    games: afterWinGames.length,
    winRate: winRate(afterWinGames),
    blundersPer100: blundersPer100(afterWinGames, blunderCountByGame),
  };

  const recommendations: string[] = [];
  if (afterLoss.games >= 15 && afterLoss.winRate < baselineWinRate - 0.06) {
    recommendations.push(
      `You score ${Math.round(afterLoss.winRate * 100)}% right after a loss vs ${Math.round(baselineWinRate * 100)}% overall — a real tilt signal. Take a break after any loss instead of hitting rematch.`,
    );
  }
  const deep = bySessionDepth[3];
  if (deep.games >= 15 && deep.winRate < bySessionDepth[0].winRate - 0.06) {
    recommendations.push(
      `Your win rate drops to ${Math.round(deep.winRate * 100)}% by the 4th+ game of a session (from ${Math.round(bySessionDepth[0].winRate * 100)}% on game one). Cap sessions at 3 rated games.`,
    );
  }
  if (longestLossStreak >= 5) {
    recommendations.push(`Your longest losing streak is ${longestLossStreak} in a row — a hard "stop after 2 losses" rule would have cut every one of those short.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("No strong tilt or fatigue pattern in your results — your play holds up after losses and deep into sessions. Keep it that way.");
  }

  return { baselineWinRate, afterLoss, afterWin, bySessionDepth, longestLossStreak, recommendations };
}
