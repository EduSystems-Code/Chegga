// Chegga Web — the tutorial's built-in example
//
// Used when the visitor has no account to connect, or when their newest
// games hold nothing clear enough to teach from. It is a beginner's
// blunder everyone recognizes: 1.e4 e5 2.Qh5 Nc6, then 3.Qxe5+?? grabs a
// pawn and loses the queen. The deeper search still runs on it (the
// heatmap and the line the guide describes come from the engine), so
// nothing in it is canned except the position and the move that was played.

import type { TeachableMoment } from "./tutorialMoment";

export const EXAMPLE_MOMENT: TeachableMoment = {
  id: "example:5",
  gameId: "example",
  opponent: "an example opponent",
  endTime: 0,
  userColor: "white",
  ply: 5,
  moveNumber: 3,
  fenBefore: "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3",
  previousMove: { from: "b8", to: "c6" },
  playedSan: "Qxe5+",
  playedUci: "h5e5",
  bestSan: "Bc4",
  bestUci: "f1c4",
  centipawnLoss: 600,
  classification: "blunder",
  blunderTag: "hung_material",
  gamePhase: "opening",
  evalBeforeCp: -20,
  evalAfterCp: -620,
  isExample: true,
};
