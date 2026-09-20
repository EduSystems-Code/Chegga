// Chegga Web — picking one synced game to review
//
// The review screen already takes any game's analysis records. What was
// missing is a way to choose which of the synced games to open. This is the
// model behind that chooser: one card per game, newest first, filterable by
// result. Pure -- the markup is gamePickerView.ts, the wiring is main.ts.

import type { GameRecord } from "./db";

export type PickerFilter = "all" | "win" | "loss" | "draw" | "analyzed";

export interface PickerCard {
  id: string; // chessComUuid
  opponent: string;
  opponentRating: number;
  yourRating: number;
  result: "win" | "loss" | "draw";
  color: "white" | "black";
  endTime: number; // unix seconds
  timeClass: string;
  opening?: string;
  analyzed: boolean;
  /** Only standard chess can be graded; a variant game is listed but not openable. */
  supported: boolean;
}

// A carousel of hundreds of cards is a wall, not a picker. The newest games
// are what someone reviewing wants; older ones stay reachable through the
// filters as the newer ones are played out.
export const PICKER_CARD_LIMIT = 60;

export function toPickerCard(g: GameRecord): PickerCard {
  const mine = g.userColor === "white";
  return {
    id: g.chessComUuid,
    opponent: mine ? g.blackUsername : g.whiteUsername,
    opponentRating: mine ? g.blackRating : g.whiteRating,
    yourRating: mine ? g.whiteRating : g.blackRating,
    result: g.userResult,
    color: g.userColor,
    endTime: g.endTime,
    timeClass: g.timeClass,
    opening: g.openingName,
    analyzed: g.analyzed,
    supported: g.rules === "chess" && g.pgn.length > 0,
  };
}

function matches(card: PickerCard, filter: PickerFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "analyzed":
      return card.analyzed;
    default:
      return card.result === filter;
  }
}

/** Newest first. */
export function buildPickerCards(games: GameRecord[], filter: PickerFilter, limit = PICKER_CARD_LIMIT): PickerCard[] {
  return games
    .map(toPickerCard)
    .filter((c) => matches(c, filter))
    .sort((a, b) => b.endTime - a.endTime)
    .slice(0, limit);
}

export function pickerCounts(games: GameRecord[]): Record<PickerFilter, number> {
  const cards = games.map(toPickerCard);
  return {
    all: cards.length,
    win: cards.filter((c) => c.result === "win").length,
    loss: cards.filter((c) => c.result === "loss").length,
    draw: cards.filter((c) => c.result === "draw").length,
    analyzed: cards.filter((c) => c.analyzed).length,
  };
}
