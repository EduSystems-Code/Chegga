// Chegga Web — raw Chess.com game -> GameRecord normalization (Phase 1)
//
// Ported from Chegga's own `app/services/pgn_parser.py::normalize_game` /
// `result_to_outcome` / `extract_opening_name`, unchanged in behavior —
// same result-code table, same opening-name heuristic, same "which color
// did the tracked user play" logic.

import type { ChessComRawGame } from "./chessComClient";
import type { GameRecord } from "./db";

// The LOSING side's code describes *how* they lost ("checkmated",
// "resigned", "timeout"), not a shared "loss" value, so both sides need
// this lookup independently. Unrecognized codes fall back to "draw"
// rather than throwing — a code Chess.com adds later shouldn't break
// ingestion of everything after it.
const RESULT_TO_OUTCOME: Record<string, "win" | "loss" | "draw"> = {
  win: "win",
  checkmated: "loss",
  agreed: "draw",
  repetition: "draw",
  timeout: "loss",
  resigned: "loss",
  stalemate: "draw",
  lose: "loss",
  insufficient: "draw",
  "50move": "draw",
  abandoned: "loss",
  kingofthehill: "loss",
  threecheck: "loss",
  timevsinsufficient: "draw",
  bughousepartnerlose: "loss",
};

export function resultToOutcome(resultCode: string): "win" | "loss" | "draw" {
  return RESULT_TO_OUTCOME[resultCode] ?? "draw";
}

// Chess.com's `eco` field is a URL into their openings pages (e.g.
// ".../openings/Italian-Game"); this is a best-effort readable name, not
// an authoritative ECO code lookup — same caveat as the backend version.
export function extractOpeningName(eco?: string): string | undefined {
  if (!eco) return undefined;
  const trimmed = eco.replace(/\/+$/, "");
  const slug = trimmed.split("/").pop() ?? "";
  const withoutVariation = slug.replace(/-\d+.*$/, "");
  const name = withoutVariation.replace(/-/g, " ").trim();
  return name || undefined;
}

export class UntrackedUserError extends Error {}

export function normalizeGame(raw: ChessComRawGame, username: string, trackedUsername: string): GameRecord {
  const trackedLower = trackedUsername.toLowerCase();

  let userColor: "white" | "black";
  if (raw.white.username.toLowerCase() === trackedLower) {
    userColor = "white";
  } else if (raw.black.username.toLowerCase() === trackedLower) {
    userColor = "black";
  } else {
    throw new UntrackedUserError(`Tracked user "${trackedUsername}" not in game ${raw.uuid}`);
  }

  const whiteOutcome = resultToOutcome(raw.white.result);
  const blackOutcome = resultToOutcome(raw.black.result);
  const userResult = userColor === "white" ? whiteOutcome : blackOutcome;

  return {
    chessComUuid: raw.uuid,
    username,
    url: raw.url ?? "",
    pgn: raw.pgn ?? "",
    timeControl: raw.time_control ?? "",
    timeClass: raw.time_class ?? "unknown",
    rules: raw.rules ?? "chess",
    rated: Boolean(raw.rated ?? false),
    endTime: raw.end_time ?? 0,
    eco: raw.eco,
    openingName: extractOpeningName(raw.eco),
    whiteUsername: raw.white.username,
    whiteRating: raw.white.rating ?? 0,
    blackUsername: raw.black.username,
    blackRating: raw.black.rating ?? 0,
    whiteResult: raw.white.result,
    blackResult: raw.black.result,
    userColor,
    userResult,
    analyzed: false,
  };
}
