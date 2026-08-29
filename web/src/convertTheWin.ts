// Chegga Web — "games you didn't convert"
//
// Reaching a winning position and not winning it is one of the cleanest,
// most fixable rating leaks at 1800-2200. This scans analyzed games where
// the result wasn't a win, finds the peak evaluation the visitor reached,
// and — for the games where that peak was clearly winning — flags the
// move where it slipped. All from Phase 2 per-move evals; no engine call.

import type { GameRecord, MoveAnalysisRecord } from "./db";

// White-relative cp threshold (converted to the visitor's side) that
// counts as "should be winning this."
const WINNING_CP = 250;
const SLIP_CP_LOSS = 120; // a single move that gave back this much is "the slip"

export interface ThrownGame {
  gameId: string;
  url: string;
  endTime: number;
  timeClass: string;
  opponentRating: number;
  result: "loss" | "draw";
  peakEvalPawns: number; // best the visitor ever stood, in pawns (from their side)
  peakMoveNumber: number; // full-move number where the peak occurred
  slipSan?: string;
  slipMoveNumber?: number;
  slipCpLoss?: number;
}

/** Convert a white-relative eval (cp + optional mate) to a single number
 * from `color`'s perspective. Mate is mapped to a large finite pawn value
 * so it always outranks any cp advantage. */
function userEvalPawns(cp: number | undefined, mate: number | undefined, color: "white" | "black"): number | undefined {
  const sign = color === "white" ? 1 : -1;
  if (mate !== undefined && mate !== 0) {
    return sign * mate > 0 ? 100 : -100;
  }
  if (cp === undefined) return undefined;
  return (sign * cp) / 100;
}

export function findThrownGames(analyzedGames: GameRecord[], ownMoves: MoveAnalysisRecord[]): ThrownGame[] {
  const movesByGame = new Map<string, MoveAnalysisRecord[]>();
  for (const m of ownMoves) {
    const arr = movesByGame.get(m.gameId) ?? [];
    arr.push(m);
    movesByGame.set(m.gameId, arr);
  }

  const out: ThrownGame[] = [];

  for (const game of analyzedGames) {
    if (game.userResult === "win") continue;
    const moves = (movesByGame.get(game.chessComUuid) ?? []).slice().sort((a, b) => a.ply - b.ply);
    if (moves.length < 8) continue;

    let peak = -Infinity;
    let peakPly = 0;
    for (const m of moves) {
      const ev = userEvalPawns(m.evalBeforeCp, m.evalBeforeMate, game.userColor);
      if (ev !== undefined && ev > peak) {
        peak = ev;
        peakPly = m.ply;
      }
    }
    if (peak < WINNING_CP / 100) continue;

    // The slip: first own move after the peak that lost a lot; fall back
    // to the single worst own move after the peak.
    const afterPeak = moves.filter((m) => m.ply >= peakPly);
    let slip = afterPeak.find((m) => m.centipawnLoss >= SLIP_CP_LOSS);
    if (!slip) {
      slip = afterPeak.slice().sort((a, b) => b.centipawnLoss - a.centipawnLoss)[0];
    }

    out.push({
      gameId: game.chessComUuid,
      url: game.url,
      endTime: game.endTime,
      timeClass: game.timeClass,
      opponentRating: game.userColor === "white" ? game.blackRating : game.whiteRating,
      result: game.userResult,
      peakEvalPawns: Math.round(peak * 10) / 10,
      peakMoveNumber: Math.ceil(peakPly / 2),
      slipSan: slip?.san,
      slipMoveNumber: slip ? Math.ceil(slip.ply / 2) : undefined,
      slipCpLoss: slip ? Math.round(slip.centipawnLoss) : undefined,
    });
  }

  // Worst throws first: a loss from +5 outranks a draw from +2.5.
  return out
    .sort((a, b) => {
      const scoreA = a.peakEvalPawns + (a.result === "loss" ? 3 : 0);
      const scoreB = b.peakEvalPawns + (b.result === "loss" ? 3 : 0);
      return scoreB - scoreA;
    })
    .slice(0, 20);
}
