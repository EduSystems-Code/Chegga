// Chegga Web — what the tutorial's guide says
//
// The guide is scripted, not an AI writer: each line is filled in from the
// real position and the engine's own numbers (the moveExplanation.ts
// approach), so it is free, instant, works offline, and never says
// something the board does not show. Plain, short sentences; no hype.
//
// Pure: strings in, strings out. tutorial.ts decides when each beat plays.

import { Chess, type Color, type PieceSymbol } from "chess.js";
import type { AnalysisLine } from "./engine";
import { hangingPieces } from "./blunderTagger";
import { cpEquivalent } from "./engineAnalysis";
import { bestMoveClauseFor, explainMove } from "./moveExplanation";
import type { TeachableMoment } from "./tutorialMoment";
import type { Site } from "./siteSync";
import { SITE_NAMES } from "./siteSync";

const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
function materialOf(board: Chess, color: Color): number {
  let total = 0;
  for (const row of board.board()) {
    for (const cell of row) if (cell && cell.color === color) total += PIECE_VALUE[cell.type];
  }
  return total;
}

// Deliberately value-based, never "a piece": a 3-point edge can be a bishop
// or three pawns, and the board is the only thing that knows which.
function materialPhrase(points: number): string {
  if (points === 1) return "a pawn";
  return `about ${points} pawns of material`;
}

/** Two or three sentences on what the position looks like to the player
 * about to move: who they are, the material, and one loose piece if there is one. */
export function describePosition(fen: string, side: "white" | "black"): string[] {
  const board = new Chess(fen);
  const me: Color = side === "white" ? "w" : "b";
  const them: Color = me === "w" ? "b" : "w";
  const sideName = side === "white" ? "White" : "Black";
  const lines = [`You are playing ${sideName}, and it is your move.`];

  const diff = materialOf(board, me) - materialOf(board, them);
  if (diff === 0) lines.push("Material is even.");
  else if (diff > 0) lines.push(`You are ahead by ${materialPhrase(diff)}.`);
  else lines.push(`You are behind by ${materialPhrase(-diff)}.`);

  // Only pieces worth a knight or more: a loose pawn is not what a first-time
  // viewer should be looking at. The square is deliberately NOT named -- this
  // beat runs before the heatmap, and "the knight on d5 is loose" is usually
  // the answer.
  const theirs = hangingPieces(board, them, 3)[0];
  const mine = hangingPieces(board, me, 3)[0];
  if (theirs) {
    lines.push("One of your opponent's pieces is under attack and not fully protected.");
  } else if (mine) {
    lines.push("One of your own pieces is under attack and not fully protected.");
  }
  return lines;
}

export interface LineOutcome {
  sanLine: string[];
  /** material the mover wins minus material the opponent wins, in pawns */
  gain: number;
  mate: boolean;
}

/** Plays the engine's line from `fen` for up to `maxPlies` moves and says
 * what happened. Stops quietly at a move that does not fit the position. */
export function lineOutcome(fen: string, pvUci: string[], maxPlies = 6): LineOutcome {
  const board = new Chess(fen);
  const mover = board.turn();
  const sanLine: string[] = [];
  let gain = 0;
  for (const uci of pvUci.slice(0, maxPlies)) {
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      sanLine.push(move.san);
      if (move.captured) gain += (move.color === mover ? 1 : -1) * PIECE_VALUE[move.captured];
    } catch {
      break;
    }
  }
  return { sanLine, gain, mate: board.isCheckmate() && sanLine.length > 0 };
}

function formatEval(cp: number): string {
  const pawns = cp / 100;
  if (Math.abs(pawns) < 0.3) return "about equal";
  // "+1.3" on its own means nothing to a new player: name the unit.
  return `${pawns > 0 ? "+" : "-"}${Math.abs(pawns).toFixed(1)} pawns for you`;
}

/** Why the engine's move is the best one here: what it does, and where the
 * engine's own line leads. Everything comes from the position and the deep
 * search of it (`deepLines`, best first). */
export function explainWhyBest(moment: TeachableMoment, deepLines: AnalysisLine[]): string[] {
  const out: string[] = [];
  const clause = bestMoveClauseFor(moment.fenBefore, moment.bestUci, moment.gamePhase);
  out.push(clause ? `${moment.bestSan} ${clause}.` : `${moment.bestSan} is the engine's top choice here.`);

  const top = deepLines[0];
  if (top && top.pv[0] === moment.bestUci) {
    const outcome = lineOutcome(moment.fenBefore, top.pv, 6);
    const shown = outcome.sanLine.slice(0, 4).join(" ");
    if (outcome.mate) {
      out.push(`Follow the engine's line (${shown}) and it ends in checkmate.`);
    } else if (outcome.gain >= 2) {
      out.push(`Follow the engine's line (${shown}) and you come out ahead by ${materialPhrase(outcome.gain)}.`);
    } else {
      out.push(`The engine rates the position ${formatEval(cpEquivalent(top.scoreCp, top.scoreMate))} after it.`);
    }
  }
  return out;
}

export type BeatId = "intro" | "position" | "heatmap" | "whyBest" | "yourTurn" | "played" | "whatItDoes";

export interface Beat {
  id: BeatId;
  title: string;
  lines: string[];
}

export interface BeatContext {
  site?: Site; // absent for the built-in example
  dateLabel?: string; // "May 28", already formatted for the reader's locale
  shadedCount: number; // how many squares the heatmap shades
  /** Said first when the example is shown in place of the visitor's own game,
   * so they know why ("I did not find a clear missed move..."). */
  exampleNote?: string;
}

function squares(uci: string): { from: string; to: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
}

/** What to say when the player makes a legal move that is not the one asked for. */
export function nudgeLine(playedSan: string, moment: TeachableMoment): string {
  const { from, to } = squares(moment.bestUci);
  return `${playedSan} is legal, but it is not the move to find here. Try ${moment.bestSan}: the piece on ${from} goes to ${to}.`;
}

export function buildBeats(moment: TeachableMoment, deepLines: AnalysisLine[], ctx: BeatContext): Beat[] {
  const colorName = moment.userColor === "white" ? "White" : "Black";
  const { from, to } = squares(moment.bestUci);

  const intro = moment.isExample
    ? [
        ...(ctx.exampleNote ? [ctx.exampleNote] : []),
        "Here is an example game, so you can see how this works.",
        `On move ${moment.moveNumber}, ${colorName} had a better move than the one played.`,
        "Look at the position first. The better move comes later.",
      ]
    : [
        `Here is a move worth a second look, from your game against ${moment.opponent}${ctx.dateLabel ? `, played ${ctx.dateLabel}` : ""}.`,
        `On move ${moment.moveNumber}, playing ${colorName}, you had a better move than the one you played.`,
        "Look at the position first. The better move comes later.",
      ];

  const played = [
    moment.isExample ? `In the example game, ${colorName} played ${moment.playedSan} instead.` : `In your game you played ${moment.playedSan}.`,
    ...explainMove({
      fenBefore: moment.fenBefore,
      san: moment.playedSan,
      uci: moment.playedUci,
      side: moment.userColor,
      classification: moment.classification,
      centipawnLoss: moment.centipawnLoss,
      bestMoveUci: moment.bestUci,
      bestMoveSan: moment.bestSan,
      blunderTag: moment.blunderTag,
      gamePhase: moment.gamePhase,
      evalBeforeCp: moment.evalBeforeCp,
      evalBeforeMate: moment.evalBeforeMate,
      evalAfterCp: moment.evalAfterCp,
      evalAfterMate: moment.evalAfterMate,
    }),
    "Every player misses moves like this. Finding them is what a second look at a game is for.",
  ];

  const siteName = ctx.site ? SITE_NAMES[ctx.site] : null;
  const whatItDoes = [
    siteName
      ? `You gave Chegga your ${siteName} username, and it read your public games from ${siteName}. There is no password, and no Chegga account to make.`
      : "Give Chegga a Chess.com or Lichess username and it reads your public games. There is no password, and no Chegga account to make.",
    "Your games stay in this browser. The engine that checks them runs here too, and your games are never uploaded anywhere.",
    "It finds the moves where a better move existed, like this one.",
    "For any position, the heatmap shows the strong moves, the arrow shows the best one, and a short reason says why. That works for any game you have played, at any move.",
    moment.isExample
      ? "Connect your username on the next page and it works on your own games."
      : "Chegga saved this position under Review a game, so you can practice it again.",
  ];

  return [
    { id: "intro", title: "A move worth a second look", lines: intro },
    { id: "position", title: "The position", lines: [...describePosition(moment.fenBefore, moment.userColor), "Take a moment to look at the board."] },
    {
      id: "heatmap",
      title: "The heatmap",
      lines: [
        "The heatmap is on now. The engine looked at every legal move in this position.",
        "A colored square is where a strong move lands, and a deeper color means a stronger move.",
        "Squares with no color are not among the engine's top moves.",
        ctx.shadedCount === 1 ? "Only one square is shaded here." : `${ctx.shadedCount} squares are shaded here.`,
      ],
    },
    { id: "whyBest", title: `Why ${moment.bestSan} is best`, lines: [...explainWhyBest(moment, deepLines), "The arrow shows it."] },
    {
      id: "yourTurn",
      title: "Your turn",
      lines: [`Play ${moment.bestSan}. Move the piece on ${from} to ${to}.`, "Click or tap the piece, then the square. You can also drag it."],
    },
    { id: "played", title: "That is the move", lines: played },
    { id: "whatItDoes", title: "What Chegga does", lines: whatItDoes },
  ];
}
