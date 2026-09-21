// Chegga Web — ask the engine for a position's ranked candidate moves
//
// Uses analysisPanel.ts's shared full-strength engine, so its serialization
// (one `go` at a time) covers this too. Two things keep stepping through a
// game from piling up engine work:
//   - results are cached per position, so revisiting a move is instant;
//   - only the most recently requested position actually runs. A request
//     that was queued and then superseded (the viewer kept stepping) is
//     skipped, so a fast click-through costs one search, not one per click.

import { Chess } from "chess.js";
import { getAnalysisEngine } from "./analysisPanel";
import type { AnalysisLine } from "./engine";

// A heatmap needs the near-best moves, not all thirty. 8 lines at this
// budget reach a depth where the ranking is stable enough to shade.
const MAX_CANDIDATES = 8;
const CANDIDATE_DEPTH = 13;
const CANDIDATE_MOVETIME_MS = 1600;

const cache = new Map<string, AnalysisLine[]>();
let latestRequested = "";
let chain: Promise<unknown> = Promise.resolve();

export function cachedCandidateLines(fen: string): AnalysisLine[] | undefined {
  return cache.get(fen);
}

/** Resolves to the ranked lines for `fen`, `[]` if the position has no
 * legal move, or `null` if a newer request superseded this one before it
 * started. Rejects if the engine fails. */
export function analyzeCandidates(fen: string): Promise<AnalysisLine[] | null> {
  const hit = cache.get(fen);
  if (hit) return Promise.resolve(hit);

  latestRequested = fen;
  const run = chain.then(async () => {
    const again = cache.get(fen);
    if (again) return again;
    if (latestRequested !== fen) return null;
    const legalMoves = new Chess(fen).moves().length;
    if (legalMoves === 0) return [];
    const engine = await getAnalysisEngine();
    const lines = await engine.analyse(fen, {
      depth: CANDIDATE_DEPTH,
      multipv: Math.min(MAX_CANDIDATES, legalMoves),
      movetimeMs: CANDIDATE_MOVETIME_MS,
    });
    cache.set(fen, lines);
    return lines;
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
