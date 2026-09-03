// Minimal record factories for the unit tests — only the fields the
// analysis functions actually read are given real defaults; override per
// test with the partial arg.
import type { GameRecord, MoveAnalysisRecord } from "../../src/db";

let seq = 0;

export function game(over: Partial<GameRecord> = {}): GameRecord {
  seq += 1;
  return {
    chessComUuid: `game-${seq}`,
    username: "tester",
    url: "",
    pgn: "",
    timeControl: "600",
    timeClass: "rapid",
    rules: "chess",
    rated: true,
    endTime: 1_700_000_000,
    eco: undefined,
    openingName: undefined,
    whiteUsername: "tester",
    whiteRating: 1500,
    blackUsername: "opp",
    blackRating: 1500,
    whiteResult: "win",
    blackResult: "resigned",
    userColor: "white",
    userResult: "win",
    analyzed: true,
    ...over,
  };
}

export function move(over: Partial<MoveAnalysisRecord> = {}): MoveAnalysisRecord {
  return {
    gameId: "game-1",
    ply: 1,
    sideToMove: "white",
    fenBefore: "",
    san: "e4",
    uci: "e2e4",
    centipawnLoss: 0,
    classification: "good",
    gamePhase: "opening",
    ...over,
  };
}
