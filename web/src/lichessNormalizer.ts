// Chegga Web — Lichess game -> GameRecord
//
// Every downstream feature (stats, the review, the picker) reads GameRecord
// and a few Chess.com-shaped codes on it, so this maps Lichess's fields to
// the same values Chess.com games get rather than teaching each feature a
// second vocabulary:
//   - the loser's `*Result` code says HOW they lost ("checkmated",
//     "resigned", "timeout") -- gamePatterns.ts reads it for "how games end";
//   - `timeClass` is one of bullet / blitz / rapid / daily
//     (strengthEstimate.ts one-hot encodes exactly those);
//   - `rules` is "chess" for anything that is standard chess, because
//     analysis and the patterns cards filter on that exact string.
// The id is prefixed so a Lichess game can never collide with a Chess.com
// uuid in the shared `games` store.

import type { GameRecord } from "./db";
import type { LichessRawGame } from "./lichessClient";

export const LICHESS_ID_PREFIX = "lichess:";

const TIME_CLASS: Record<string, string> = {
  ultraBullet: "bullet",
  bullet: "bullet",
  blitz: "blitz",
  rapid: "rapid",
  classical: "rapid",
  correspondence: "daily",
};

// How the LOSING side lost, in Chess.com's vocabulary.
const LOSER_CODE: Record<string, string> = {
  mate: "checkmated",
  resign: "resigned",
  timeout: "timeout",
  outoftime: "timeout",
};

const DRAW_CODE: Record<string, string> = {
  stalemate: "stalemate",
  draw: "agreed", // Lichess does not say whether it was agreed, repetition or 50 moves
};

/** Games that never really started, or ended for a reason with no result
 * to learn from, are not worth storing. */
function isPlayed(raw: LichessRawGame): boolean {
  const status = raw.status ?? "";
  return !["created", "started", "aborted", "noStart", "unknownFinish", "cheat", "variantEnd"].includes(status);
}

function pgnHeader(pgn: string | undefined, tag: string): string | undefined {
  if (!pgn) return undefined;
  return new RegExp(`\\[${tag} "([^"]*)"\\]`).exec(pgn)?.[1];
}

function timeControlOf(raw: LichessRawGame): string {
  const fromHeader = pgnHeader(raw.pgn, "TimeControl");
  if (fromHeader && fromHeader !== "-") return fromHeader;
  if (raw.clock) return `${raw.clock.initial}+${raw.clock.increment}`;
  return raw.speed === "correspondence" ? "1/86400" : "";
}

export function normalizeLichessGame(raw: LichessRawGame, username: string): GameRecord | null {
  if (!isPlayed(raw) || !raw.players?.white || !raw.players.black) return null;

  const tracked = username.toLowerCase();
  const isMine = (p: { user?: { name: string; id?: string } }) =>
    p.user?.name.toLowerCase() === tracked || p.user?.id === tracked;
  const userColor: "white" | "black" | null = isMine(raw.players.white)
    ? "white"
    : isMine(raw.players.black)
      ? "black"
      : null;
  if (!userColor) return null;

  const status = raw.status ?? "";
  let whiteResult: string;
  let blackResult: string;
  if (raw.winner) {
    const loserCode = LOSER_CODE[status] ?? "resigned";
    whiteResult = raw.winner === "white" ? "win" : loserCode;
    blackResult = raw.winner === "black" ? "win" : loserCode;
  } else {
    const drawCode = DRAW_CODE[status] ?? "agreed";
    whiteResult = drawCode;
    blackResult = drawCode;
  }
  const userResult: "win" | "loss" | "draw" = !raw.winner ? "draw" : raw.winner === userColor ? "win" : "loss";

  const variant = raw.variant ?? "standard";
  const isStandardChess = variant === "standard" || variant === "fromPosition";

  const name = (p: { user?: { name: string } }) => p.user?.name ?? "Anonymous";
  return {
    chessComUuid: `${LICHESS_ID_PREFIX}${raw.id}`,
    username,
    url: `https://lichess.org/${raw.id}`,
    pgn: raw.pgn ?? "",
    timeControl: timeControlOf(raw),
    timeClass: TIME_CLASS[raw.speed ?? ""] ?? "rapid",
    rules: isStandardChess ? "chess" : variant,
    rated: Boolean(raw.rated),
    endTime: Math.floor((raw.lastMoveAt ?? raw.createdAt ?? 0) / 1000),
    eco: raw.opening?.eco,
    openingName: raw.opening?.name,
    whiteUsername: name(raw.players.white),
    whiteRating: raw.players.white.rating ?? 0,
    blackUsername: name(raw.players.black),
    blackRating: raw.players.black.rating ?? 0,
    whiteResult,
    blackResult,
    userColor,
    userResult,
    analyzed: false,
  };
}
