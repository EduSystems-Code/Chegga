// Chegga Web — plain-language "why" for a graded move
//
// Engine-based, not an AI writer: every sentence here comes from numbers
// the analysis already stored (the tier, the centipawn loss, the engine's
// preferred move, the blunder tag, the evals) plus a few simple board
// checks made with chess.js (what the better move captures, whether it
// gives check, which piece the played move left hanging). No network, no
// API key, instant. The wording is deliberately modest -- it names what
// the engine's move does and what the played move gave up; it does not
// pretend to teach a plan.
//
// Pure: takes an ExplainInput, returns short sentences.

import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { hangingPieces } from "./blunderTagger";
import type { Puzzle } from "./puzzleTrainer";
import type { ReviewStep } from "./gameReview";

export interface ExplainInput {
  fenBefore: string;
  san: string; // the move that was played
  uci: string;
  side: "white" | "black"; // who played it
  classification?: string;
  centipawnLoss?: number;
  bestMoveUci?: string;
  bestMoveSan?: string;
  blunderTag?: string;
  gamePhase?: "opening" | "middlegame" | "endgame";
  // White-relative, the way MoveAnalysisRecord stores them. Optional: a
  // saved puzzle doesn't carry them.
  evalBeforeCp?: number;
  evalBeforeMate?: number;
  evalAfterCp?: number;
  evalAfterMate?: number;
}

export function explainInputFromStep(step: ReviewStep): ExplainInput {
  return {
    fenBefore: step.fenBefore,
    san: step.san,
    uci: step.uci,
    side: step.side,
    classification: step.classification,
    centipawnLoss: step.centipawnLoss,
    bestMoveUci: step.bestMoveUci,
    bestMoveSan: step.bestMoveSan,
    blunderTag: step.blunderTag,
    gamePhase: step.gamePhase,
    evalBeforeCp: step.evalBeforeCp,
    evalBeforeMate: step.evalBeforeMate,
    evalAfterCp: step.evalAfterCp,
    evalAfterMate: step.evalAfterMate,
  };
}

export function explainInputFromPuzzle(p: Puzzle): ExplainInput {
  return {
    fenBefore: p.fenBefore,
    san: p.playedSan,
    uci: p.playedUci,
    side: p.sideToMove,
    classification: p.classification,
    centipawnLoss: p.centipawnLoss,
    bestMoveUci: p.bestMoveUci,
    bestMoveSan: p.bestMoveSan,
    blunderTag: p.blunderTag,
    gamePhase: p.gamePhase,
  };
}

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

interface MoveFacts {
  piece: PieceSymbol;
  captured?: PieceSymbol;
  to: Square;
  from: Square;
  gaveCheck: boolean;
  gaveMate: boolean;
  castled: boolean;
  promoted: boolean;
  developsMinorPiece: boolean;
}

function moveFacts(fen: string, uci: string): MoveFacts | null {
  try {
    const board = new Chess(fen);
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    const backRank = move.color === "w" ? "1" : "8";
    return {
      piece: move.piece,
      captured: move.captured,
      to: move.to,
      from: move.from,
      gaveCheck: move.san.includes("+") || move.san.includes("#"),
      gaveMate: move.san.includes("#"),
      castled: move.san.startsWith("O-O"),
      promoted: !!move.promotion,
      developsMinorPiece: (move.piece === "n" || move.piece === "b") && move.from[1] === backRank && move.to[1] !== backRank,
    };
  } catch {
    return null; // a stale or mismatched position -- say nothing rather than guess
  }
}

/** What the engine's move does, as a short clause that follows "it ". */
function bestMoveClause(facts: MoveFacts | null, phase: ExplainInput["gamePhase"]): string | null {
  if (!facts) return null;
  if (facts.gaveMate) return "delivers checkmate";
  if (facts.captured) {
    return `captures the ${PIECE_NAME[facts.captured]} on ${facts.to}${facts.gaveCheck ? " with check" : ""}`;
  }
  if (facts.promoted) return "promotes a pawn";
  if (facts.castled) return "castles, which brings your king to safety";
  if (facts.gaveCheck) return "gives check";
  if (facts.developsMinorPiece && phase === "opening") return `develops your ${PIECE_NAME[facts.piece]}`;
  return null;
}

/** What the engine's move does, from the position it is played in, as a
 * short clause ("captures the knight on d5"), or null when it does nothing
 * a sentence can name. Exported for the tutorial, which explains why the
 * best move is best before the player has played anything. */
export function bestMoveClauseFor(fen: string, uci: string, phase: ExplainInput["gamePhase"]): string | null {
  return bestMoveClause(moveFacts(fen, uci), phase);
}

/** Mover-relative, in pawns: +1.3 is good for the mover, -0.4 is bad. */
function moverEval(cp: number | undefined, mate: number | undefined, side: "white" | "black") {
  const sign = side === "white" ? 1 : -1;
  return {
    cp: cp !== undefined ? cp * sign : undefined,
    mate: mate !== undefined ? mate * sign : undefined,
  };
}

function describeEval(e: { cp?: number; mate?: number }): string | null {
  if (e.mate !== undefined) {
    return e.mate > 0 ? `a forced mate for you in ${Math.abs(e.mate)}` : `mate against you in ${Math.abs(e.mate)}`;
  }
  if (e.cp === undefined) return null;
  const pawns = e.cp / 100;
  if (Math.abs(pawns) < 0.3) return "about equal";
  return `${pawns > 0 ? "+" : "-"}${Math.abs(pawns).toFixed(1)}`;
}

function evalSentence(input: ExplainInput): string | null {
  if (input.evalBeforeCp === undefined && input.evalBeforeMate === undefined) return null;
  if (input.evalAfterCp === undefined && input.evalAfterMate === undefined) return null;
  const before = describeEval(moverEval(input.evalBeforeCp, input.evalBeforeMate, input.side));
  const after = describeEval(moverEval(input.evalAfterCp, input.evalAfterMate, input.side));
  if (!before || !after || before === after) return null;
  return `The engine's evaluation for you went from ${before} to ${after}.`;
}

function hungSentence(input: ExplainInput): string | null {
  try {
    const before = new Chess(input.fenBefore);
    const color: Color = before.turn();
    const hangingBefore = new Set(hangingPieces(before, color).map((p) => p.square));
    const after = new Chess(input.fenBefore);
    const played = after.move({
      from: input.uci.slice(0, 2),
      to: input.uci.slice(2, 4),
      promotion: input.uci.slice(4) || undefined,
    });
    const hangingAfter = hangingPieces(after, color);
    const fresh = hangingAfter.find((p) => !hangingBefore.has(p.square) || p.square === played.to);
    if (fresh) return `${input.san} leaves your ${PIECE_NAME[fresh.type]} on ${fresh.square} open to capture.`;
    const stillHanging = hangingAfter[0];
    if (stillHanging) {
      return `Your ${PIECE_NAME[stillHanging.type]} on ${stillHanging.square} was already under attack, and ${input.san} did not save it.`;
    }
  } catch {
    // fall through to the generic wording
  }
  return `${input.san} leaves a piece open to capture.`;
}

function pawnsLost(cp: number): string {
  return (cp / 100).toFixed(1);
}

/** One to three short sentences saying why the move was good or bad.
 * Empty when the move isn't graded -- there is nothing honest to say. */
export function explainMove(input: ExplainInput): string[] {
  const tier = input.classification;
  if (!tier) return [];
  const best = input.bestMoveSan;
  const bestDiffers = !!best && best !== input.san;
  const out: string[] = [];

  if (tier === "best") {
    out.push("This was the engine's top choice.");
    return out;
  }
  if (tier === "excellent" || tier === "good") {
    out.push(
      bestDiffers
        ? `A sound move. The engine's top choice was ${best}, but the difference is small${input.centipawnLoss ? ` (${input.centipawnLoss}cp)` : ""}.`
        : "A sound move, close to the engine's top choice.",
    );
    return out;
  }

  // inaccuracy / mistake / blunder from here on
  const bestFacts = input.bestMoveUci ? moveFacts(input.fenBefore, input.bestMoveUci) : null;

  switch (input.blunderTag) {
    case "missed_mate":
      out.push(best ? `You had a forced mate here. ${best} starts it.` : "You had a forced mate here.");
      break;
    case "allowed_mate":
      out.push(
        best
          ? `${input.san} allows a forced mate against you. ${best} avoids it.`
          : `${input.san} allows a forced mate against you.`,
      );
      break;
    case "hung_material": {
      const hung = hungSentence(input);
      if (hung) out.push(hung);
      if (bestDiffers) out.push(`${best} was better.`);
      break;
    }
    case "missed_capture": {
      const clause = bestMoveClause(bestFacts, input.gamePhase);
      out.push(
        bestDiffers
          ? `${best} ${clause ?? "wins material"}. You passed it up.`
          : "You passed up a capture that wins material.",
      );
      break;
    }
    default: {
      if (bestDiffers) {
        const clause = bestMoveClause(bestFacts, input.gamePhase);
        out.push(clause ? `${best} was stronger: it ${clause}.` : `${best} was stronger.`);
      }
    }
  }

  const evalLine = evalSentence(input);
  if (evalLine) {
    out.push(evalLine);
  } else if (input.centipawnLoss && input.centipawnLoss > 0 && !input.blunderTag?.endsWith("mate")) {
    out.push(`Compared with the engine's move, this gave up about ${pawnsLost(input.centipawnLoss)} pawns.`);
  }
  return out;
}
