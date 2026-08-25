// Chegga Web — instant post-game report for a just-finished bot game
//
// Reuses the exact same engineAnalysis.ts/profileService.ts pipeline
// that already grades real synced Chess.com games -- a bot game is just
// a GameRecord with a PGN, so it goes through the identical path. Zero
// new analysis logic, just a synthetic GameRecord built from a finished
// PlayBoard.

import { Chess } from "chess.js";
import { getAnalysisEngine } from "./analysisPanel";
import { analyzeGame, DEFAULT_ANALYSIS_OPTIONS } from "./engineAnalysis";
import { computeProfile } from "./profileService";
import { accuracyFromCpLoss } from "./statsInsights";
import type { GameRecord, MoveAnalysisRecord } from "./db";

export interface PostGameReport {
  accuracy: number;
  avgCentipawnLoss: number;
  totalMoves: number;
  blunderCount: number;
  mistakeCount: number;
  worstMove?: MoveAnalysisRecord;
}

function buildSyntheticGame(pgn: string, humanColor: "white" | "black"): GameRecord {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const outcome = chess.isCheckmate()
    ? (chess.turn() === "w" ? "black" : "white") === humanColor
      ? "win"
      : "loss"
    : "draw";

  return {
    chessComUuid: `bot-game-${Date.now()}`,
    username: "bot-game",
    url: "",
    pgn,
    timeControl: "0", // no clock in a bot game -- 0 reads as "no time pressure data," which is correct here
    timeClass: "unknown",
    rules: "chess",
    rated: false,
    endTime: Math.floor(Date.now() / 1000),
    whiteUsername: humanColor === "white" ? "you" : "bot",
    whiteRating: 0,
    blackUsername: humanColor === "black" ? "you" : "bot",
    blackRating: 0,
    whiteResult: humanColor === "white" ? outcome : outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw",
    blackResult: humanColor === "black" ? outcome : outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw",
    userColor: humanColor,
    userResult: outcome as "win" | "loss" | "draw",
    analyzed: false,
  };
}

export async function analyzeFinishedBotGame(pgn: string, humanColor: "white" | "black"): Promise<PostGameReport> {
  const engine = await getAnalysisEngine();
  const game = buildSyntheticGame(pgn, humanColor);
  const moves = await analyzeGame(engine, game, DEFAULT_ANALYSIS_OPTIONS);
  const ownMoves = moves.filter((m) => m.sideToMove === humanColor);

  const profile = computeProfile([game], ownMoves);
  const worstMove = [...ownMoves].sort((a, b) => b.centipawnLoss - a.centipawnLoss)[0];

  return {
    accuracy: accuracyFromCpLoss(profile.avgCentipawnLoss),
    avgCentipawnLoss: profile.avgCentipawnLoss,
    totalMoves: profile.totalMoves,
    blunderCount: profile.classificationCounts.blunder ?? 0,
    mistakeCount: profile.classificationCounts.mistake ?? 0,
    worstMove,
  };
}

export function renderPostGameReport(report: PostGameReport): string {
  const worst = report.worstMove
    ? `<div class="insight-item">Your costliest move: <strong>${report.worstMove.san}</strong> (-${report.worstMove.centipawnLoss}cp, ${report.worstMove.classification}).</div>`
    : "";
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${report.accuracy}</div><div class="stat-label">accuracy</div></div>
      <div class="stat-card"><div class="stat-value">${report.avgCentipawnLoss}</div><div class="stat-label">avg cp loss</div></div>
      <div class="stat-card"><div class="stat-value">${report.blunderCount}</div><div class="stat-label">blunders</div></div>
      <div class="stat-card"><div class="stat-value">${report.mistakeCount}</div><div class="stat-label">mistakes</div></div>
    </div>
    ${worst}
  `;
}

/** Annotated PGN: each own move that graded as mistake/blunder gets an
 * inline comment with what the engine preferred instead -- reusable for
 * bot games and for the dev-tools paste-a-PGN flow, since both already
 * produce the same MoveAnalysisRecord[] shape. */
export function buildAnnotatedPgn(pgn: string, moves: MoveAnalysisRecord[], humanColor: "white" | "black"): string {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const byPly = new Map(moves.map((m) => [m.ply, m]));

  const replay = new Chess();
  const sanHistory = chess.history();
  for (let i = 0; i < sanHistory.length; i++) {
    const ply = i + 1;
    replay.move(sanHistory[i]);
    const analysis = byPly.get(ply);
    if (!analysis || analysis.sideToMove !== humanColor) continue;
    if (analysis.classification !== "mistake" && analysis.classification !== "blunder") continue;
    const note = `${analysis.classification}: -${analysis.centipawnLoss}cp${analysis.bestMoveSan ? `, better was ${analysis.bestMoveSan}` : ""}`;
    replay.setComment(note);
  }
  return replay.pgn();
}

/** Returns whether the download actually fired -- some embedded/
 * restricted browser contexts block Blob downloads outright; the caller
 * uses this to show a fallback instead of pretending it worked. */
export function downloadTextFile(filename: string, content: string): boolean {
  try {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.warn("PGN download unavailable in this browser context.", err);
    return false;
  }
}
