// Chegga Web — Elo-scaled bot opponent (100–3000)
//
// Stockfish's own UCI_Elo option only goes down to 1320 (confirmed live
// against the actual `stockfish-18-lite-single` build's `uci` handshake
// output: "option name UCI_Elo type spin default 1320 min 1320 max
// 3190") — below that, the engine simply won't play any weaker no matter
// what you ask it for. So this file is two different strategies stitched
// together at that boundary:
//
//   - Elo >= 1320: hand off entirely to the engine's own
//     UCI_LimitStrength + UCI_Elo. Real, well-tested weakening, not
//     reinvented.
//   - Elo < 1320: the engine is asked for its top few candidate moves at
//     a shallow, Elo-scaled depth, then a move is sampled from them with
//     a softmax over their evaluations — a "temperature" that rises as
//     Elo falls, so a 100-rated bot picks a bad move often and a
//     1200-rated bot picks a slightly-off move occasionally. This is the
//     same shape of technique (weighted sampling over shallow candidates,
//     not "always play the best move you can find") used by most weak
//     bots in chess apps generally; there's no backend/ground-truth
//     version of this to port against since Chegga's own backend never
//     played a game, only analyzed them.

import { Chess } from "chess.js";
import type { Engine, AnalysisLine } from "./engine";

const NATIVE_ELO_FLOOR = 1320;
const NATIVE_ELO_CEILING = 3190;

export interface BotMove {
  uci: string;
  san: string;
}

/** Depth for the sub-1320 shallow-search path: shallower at the very
 * bottom of the range (more "doesn't see the threat" blindness on top of
 * the randomness) rising toward the native floor's own depth. */
function weakSearchDepth(elo: number): number {
  const t = Math.max(0, Math.min(1, (elo - 100) / (NATIVE_ELO_FLOOR - 100)));
  return Math.round(3 + t * 5); // depth 3 at Elo 100 -> depth 8 near Elo 1320
}

/** Softmax "temperature" in centipawns: 0 = always the engine's best
 * move; higher = candidates get picked more evenly regardless of how bad
 * they are. Scaled so it's ~0 right at the native floor (a smooth
 * handoff, not a cliff) and largest at the bottom of the range. */
function weaknessTemperature(elo: number): number {
  const t = Math.max(0, Math.min(1, (NATIVE_ELO_FLOOR - elo) / (NATIVE_ELO_FLOOR - 100)));
  return t * 260;
}

function softmaxSample(lines: AnalysisLine[], temperature: number): AnalysisLine {
  if (temperature <= 0 || lines.length === 1) return lines[0];

  // Every line's score, mover-relative in centipawns (mate scores treated
  // as a large magnitude so a forced mate still dominates the softmax
  // rather than being skipped over as "no cp score").
  const scores = lines.map((l) => (l.scoreMate !== undefined ? Math.sign(l.scoreMate || 1) * 100_000 : (l.scoreCp ?? 0)));
  const maxScore = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - maxScore) / temperature));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let r = Math.random() * totalWeight;
  for (let i = 0; i < lines.length; i++) {
    r -= weights[i];
    if (r <= 0) return lines[i];
  }
  return lines[lines.length - 1];
}

// Per-engine-instance state (not module-level) -- this app can have more
// than one Engine alive at once (e.g. the dev-tools analysis engine and a
// bot-game engine), and they must not share "what did I last configure"
// bookkeeping.
const engineState = new WeakMap<Engine, { limitStrength: boolean | null; elo: number | null }>();

function stateFor(engine: Engine) {
  let s = engineState.get(engine);
  if (!s) {
    s = { limitStrength: null, elo: null };
    engineState.set(engine, s);
  }
  return s;
}

async function configureNativeStrength(engine: Engine, elo: number): Promise<void> {
  const clamped = Math.max(NATIVE_ELO_FLOOR, Math.min(NATIVE_ELO_CEILING, Math.round(elo)));
  const state = stateFor(engine);
  if (state.limitStrength !== true) {
    engine.send("setoption name UCI_LimitStrength value true");
    state.limitStrength = true;
  }
  if (state.elo !== clamped) {
    engine.send(`setoption name UCI_Elo value ${clamped}`);
    state.elo = clamped;
  }
}

async function disableNativeStrength(engine: Engine): Promise<void> {
  const state = stateFor(engine);
  if (state.limitStrength !== false) {
    engine.send("setoption name UCI_LimitStrength value false");
    state.limitStrength = false;
  }
}

/** Picks the bot's move for the given position. `elo` is the bot's
 * target strength, 100-3000. Throws if there are no legal moves (caller
 * should already know the game isn't over before calling this). */
export async function chooseBotMove(engine: Engine, fen: string, elo: number): Promise<BotMove> {
  let uci: string;

  if (elo >= NATIVE_ELO_FLOOR) {
    await configureNativeStrength(engine, elo);
    const lines = await engine.analyse(fen, { depth: 14, multipv: 1, movetimeMs: 400 });
    const best = lines[0];
    if (!best) throw new Error("Engine returned no move for position");
    uci = best.pv[0];
  } else {
    await disableNativeStrength(engine);
    const depth = weakSearchDepth(elo);
    const lines = await engine.analyse(fen, { depth, multipv: 6, movetimeMs: 250 });
    if (lines.length === 0) throw new Error("Engine returned no move for position");
    uci = softmaxSample(lines, weaknessTemperature(elo)).pv[0];
  }

  const board = new Chess(fen);
  const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
  return { uci, san: move.san };
}
