// Chegga Web — builds the bundled demo dataset (public/demo-data.json).
//
// The demo dataset is what a first-time visitor sees when they click "See a
// demo" instead of connecting a real account: a fabricated player's synced
// history, already analyzed, loaded through the same importAllData path a
// real backup restore uses.
//
// Everything here is invented. There is no real account, no real games and
// no engine run behind it. Moves are legal (chess.js validates every one and
// re-parses the finished PGN), but the evals and classifications are
// synthesized from a scripted arc rather than measured — which is the whole
// point: the fixture has to be buildable with no Stockfish and no network.
//
// The arcs are not decorative. Each growth card hides itself until its own
// data gate passes, so the dataset is shaped to clear all five:
//   - Consistency & tilt       >= 10 rated games (and a 5-loss streak, so it
//                                 produces a real recommendation, not the
//                                 "no strong pattern" fallback)
//   - Blunder rate over time   >= 2 calendar months with >= 20 own moves each
//   - Games you didn't convert >= 1 non-win game, >= 8 own moves, peak eval
//                                 >= +2.5 pawns from the player's side
//   - Road to a target rating  >= 1 game with >= 5 own moves (strength model)
//   - This week's plan         always renders
// checkGates() below asserts every one of those against the real app
// functions' thresholds, so a regenerate that quietly stops satisfying a card
// fails the build instead of shipping a half-empty demo.
//
// Run: node scripts/generate-demo-data.mjs

import { Chess } from "chess.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo-data.json");

export const DEMO_USERNAME = "chegga-demo";
const OPPONENTS = [
  "RookAndRoll", "PawnStorm88", "KnightOwl_", "BishopTakes", "QueensideCastle",
  "EnPassantly", "ZugzwangZoe", "ForkInTheRoad", "SkewerSam", "LuftMachine",
  "TempoTantrum", "FianchettoFan", "PerpetualPete", "OpenFileOllie",
];

// --- seeded RNG (deterministic output: same file every run) ---

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// --- opening book: real, standard lines (chess.js validates each) ---

const BOOK = [
  { eco: "C50", name: "Italian Game", moves: ["e4","e5","Nf3","Nc6","Bc4","Bc5","c3","Nf6","d3","d6","O-O","O-O"] },
  { eco: "B90", name: "Sicilian Defense: Najdorf Variation", moves: ["e4","c5","Nf3","d6","d4","cxd4","Nxd4","Nf6","Nc3","a6","Be3","e5"] },
  { eco: "C03", name: "French Defense: Tarrasch Variation", moves: ["e4","e6","d4","d5","Nd2","Nf6","e5","Nfd7","Bd3","c5","c3","Nc6"] },
  { eco: "D37", name: "Queen's Gambit Declined", moves: ["d4","d5","c4","e6","Nc3","Nf6","Nf3","Be7","Bf4","O-O","e3","c5"] },
  { eco: "D02", name: "London System", moves: ["d4","Nf6","Nf3","e6","Bf4","d5","e3","c5","c3","Nc6","Nbd2","Bd6"] },
  { eco: "B12", name: "Caro-Kann Defense: Advance Variation", moves: ["e4","c6","d4","d5","e5","Bf5","Nf3","e6","Be2","Nd7","O-O","Ne7"] },
  { eco: "C65", name: "Ruy Lopez: Berlin Defense", moves: ["e4","e5","Nf3","Nc6","Bb5","Nf6","O-O","Nxe4","d4","Nd6","Bxc6","dxc6"] },
  { eco: "E60", name: "King's Indian Defense", moves: ["d4","Nf6","c4","g6","Nc3","Bg7","e4","d6","Nf3","O-O","Be2","e5"] },
  { eco: "B01", name: "Scandinavian Defense", moves: ["e4","d5","exd5","Qxd5","Nc3","Qa5","d4","Nf6","Nf3","c6","Bc4","Bf5"] },
  { eco: "D10", name: "Slav Defense", moves: ["d4","d5","c4","c6","Nf3","Nf6","Nc3","dxc4","a4","Bf5","e3","e6"] },
];

// --- heuristic move picker: legal, plausible club-level moves ---

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** One-ply lookahead: the best material the opponent can win right back. */
function opponentBestCapture(chess) {
  let best = 0;
  for (const reply of chess.moves({ verbose: true })) {
    if (!reply.captured) continue;
    best = Math.max(best, VALUE[reply.captured] - VALUE[reply.piece] * 0.4);
  }
  return best;
}

function scoreMove(chess, m, ply, rng) {
  let s = rng() * 1.2;
  if (m.captured) s += 10 * VALUE[m.captured] - VALUE[m.piece];
  if (m.promotion) s += 80;
  if (m.flags.includes("k") || m.flags.includes("q")) s += ply < 24 ? 7 : 2;
  if (ply < 20 && (m.piece === "n" || m.piece === "b") && /[18]/.test(m.from)) s += 4;
  if (ply < 16 && m.piece === "p" && /^[de]/.test(m.to)) s += 2.5;
  if (ply > 30 && m.piece === "p" && /[27]/.test(m.to)) s += 3;
  // Without these the walk produces legal but silly-looking games: kings
  // strolling up the board mid-game, and minor pieces shuffling back home.
  if (m.piece === "k" && !m.flags.includes("k") && !m.flags.includes("q") && ply < 60) s -= 6;
  if ((m.piece === "n" || m.piece === "b") && /[18]/.test(m.to) && ply > 16) s -= 3;

  chess.move(m.san);
  if (chess.isCheckmate()) s += 1000;
  else {
    if (chess.inCheck()) s += 3;
    s -= 8 * opponentBestCapture(chess);
  }
  chess.undo();
  return s;
}

/** Ranked legal moves, best first. */
function rankMoves(chess, ply, rng) {
  return chess
    .moves({ verbose: true })
    .map((m) => ({ m, s: scoreMove(chess, m, ply, rng) }))
    .sort((a, b) => b.s - a.s);
}

// --- classification / eval model ---

// Deliberately the same boundaries as engineAnalysis.ts's
// CLASSIFICATION_THRESHOLDS, so a stored label always agrees with what the
// app's own classify() would return for that centipawn loss. Any drift here
// would ship a fixture that contradicts itself the moment anything recomputes.
const CP_RANGE = {
  best: [0, 10],
  excellent: [11, 25],
  good: [26, 50],
  inaccuracy: [51, 100],
  mistake: [101, 200],
  blunder: [201, 600],
};

/** Mirrors engineAnalysis.ts's `classify`. */
function classifyCp(centipawnLoss) {
  if (centipawnLoss <= 10) return "best";
  if (centipawnLoss <= 25) return "excellent";
  if (centipawnLoss <= 50) return "good";
  if (centipawnLoss <= 100) return "inaccuracy";
  if (centipawnLoss <= 200) return "mistake";
  return "blunder";
}

// Weights by how badly the side is playing in this stretch of the game.
// "steady" is the baseline club player; "sloppy" is the side that is about
// to hand over a winning position.
//
// The blunder weights look high next to a titled player's, and are meant to:
// the demo player is a ~1400-1500 club rapid player averaging ~95cp loss a
// move, and a player that inaccurate who only blundered 4% of the time would
// be internally inconsistent. ("Blunder" here is this project's own cp-loss
// threshold, not a universal standard — see context.md.)
//
// The floor is load-bearing, not taste: "Road to a target rating" drops any
// area worth under 3 model points, and against the frozen strength model at
// its default 2000 target that needs an own-blunder rate above ~11.2%. Below
// that the card renders its "no obvious quality gap" fallback and the demo
// shows a growth card with no bars in it. checkGates() enforces the band.
const MIX = {
  sharp:  { best: 32, excellent: 25, good: 28, inaccuracy: 10, mistake: 3,  blunder: 2 },
  steady: { best: 16, excellent: 14, good: 28, inaccuracy: 17, mistake: 11, blunder: 14 },
  sloppy: { best: 8,  excellent: 9,  good: 21, inaccuracy: 21, mistake: 18, blunder: 23 },
};

function sampleClassification(rng, mix) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const [cls, w] of Object.entries(mix)) {
    roll -= w;
    if (roll <= 0) return cls;
  }
  return "good";
}

const OVERSIGHT_TAGS = ["hung_material", "missed_capture", "missed_mate", "allowed_mate"];

function blunderTagFor(rng, cls) {
  if (cls === "blunder") return rng() < 0.78 ? pick(rng, OVERSIGHT_TAGS) : "positional";
  if (cls === "mistake") return rng() < 0.45 ? pick(rng, OVERSIGHT_TAGS) : "positional";
  return undefined;
}

/** Deliberately identical to engineAnalysis.ts's `gamePhase(ply, boardBefore)`
 * — piece *count*, not material value — so the fixture's phase split is the
 * one a real analysis of these same games would produce. */
function phaseFor(chess, ply) {
  if (ply <= 20) return "opening";
  let pieces = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.type !== "p" && sq.type !== "k") pieces += 1;
    }
  }
  return pieces <= 6 ? "endgame" : "middlegame";
}

const BANDS = [
  ["critical (<10% time left)", 0.0, 0.1],
  ["low (10-30%)", 0.1, 0.3],
  ["comfortable (30-70%)", 0.3, 0.7],
  ["plenty (>70%)", 0.7, 10.0],
];

function bandFor(clockSeconds, base) {
  const f = clockSeconds / base;
  for (const [label, lo, hi] of BANDS) if (f >= lo && f < hi) return label;
  return undefined;
}

// --- one game, in two passes ---
//
// Pass 1 (playGame) picks legal moves and is the expensive half: every
// candidate move is tried and scored with a one-ply lookahead. Pass 2
// (scoreGame) overlays the synthetic evals and classifications and is pure
// arithmetic. They are split because the scripted arcs are stochastic — a
// "thrown" game has to actually reach a winning position — and retrying the
// cheap half is free, where replaying the moves is not.

function playGame(spec, seed) {
  const rng = mulberry32(seed);
  const chess = new Chess();
  const book = spec.book;
  const plies = [];

  for (let ply = 1; ply <= spec.targetPlies; ply++) {
    if (chess.isGameOver()) break;

    const moverIsWhite = chess.turn() === "w";
    const mover = moverIsWhite ? "white" : "black";
    const fenBefore = chess.fen();
    const phase = phaseFor(chess, ply);

    let played;
    let best;
    if (ply <= book.moves.length) {
      // Book moves need no search — they are the line, and they are "best".
      const bookSan = book.moves[ply - 1];
      played = chess.moves({ verbose: true }).find((m) => m.san === bookSan);
      if (!played) throw new Error(`Book line "${book.name}" has an illegal move at ply ${ply}: ${bookSan}`);
      best = played;
    } else {
      const ranked = rankMoves(chess, ply, rng);
      if (ranked.length === 0) break;
      best = ranked[0].m;
      played = ranked[Math.min(ranked.length - 1, randInt(rng, 0, rng() < 0.7 ? 1 : 2))].m;
    }

    chess.move(played.san);
    plies.push({
      ply,
      mover,
      moverIsWhite,
      isUser: mover === spec.userColor,
      isBook: ply <= book.moves.length,
      fenBefore,
      phase,
      san: played.san,
      uci: played.lan,
      bestSan: best.san,
      bestUci: best.lan,
      playedIsBest: best.san === played.san,
    });
  }

  return { plies, chess };
}

/**
 * `spec.errorScript(ply, isUser)` picks which MIX a side plays at that point,
 * which is how the arcs are steered: to build a winning position for the
 * player we make the opponent play "sloppy" for a stretch, which is what
 * actually happens in a game you go on to throw away. `forcedErrorPlies`
 * pins specific opponent blunders so a scripted comeback is not left to luck.
 */
function scoreGame(plies, spec, seed, forcedErrorPlies = new Set()) {
  const rng = mulberry32(seed);
  const base = spec.baseSeconds;
  const clocks = { w: base, b: base };
  let evalWhite = randInt(rng, -20, 20);
  let peakUserCp = -Infinity;
  const records = [];

  // Every ply moves the evaluation against whoever moved, so without a brake
  // the side that is scripted to play worse simply accumulates error until
  // the eval saturates at its clamp — and then every game reports the same
  // absurd peak. The brake is behavioural rather than a second clamp: a side
  // that is already losing badly stops handing over more material. Their
  // opponent keeps making ordinary errors, so the evaluation drifts back
  // toward the middle instead of running away, which is both self-limiting
  // and the shape a real "winning but not converting" game has.
  const CRUSHING_CP = 400;

  for (const p of plies) {
    const moverEval = p.moverIsWhite ? evalWhite : -evalWhite;
    const moverIsLost = moverEval <= -CRUSHING_CP;

    let cpLoss;
    if (forcedErrorPlies.has(p.ply) && !moverIsLost) {
      cpLoss = randInt(rng, 220, 320);
    } else {
      const mix = p.isBook || moverIsLost ? MIX.sharp : MIX[spec.errorScript(p.ply, p.isUser)];
      const [lo, hi] = CP_RANGE[sampleClassification(rng, mix)];
      cpLoss = randInt(rng, lo, hi);
    }

    // There is only so much left to give away when you are already lost, so
    // errors shrink as the position does. This is what actually stops the
    // walk saturating: a single blunder just past the threshold could
    // otherwise still fling the eval to the clamp in one move.
    if (moverEval < -200) {
      const over = Math.min(1, (-moverEval - 200) / 500);
      cpLoss = Math.max(0, Math.round(cpLoss * (1 - 0.9 * over)));
    }
    // Re-derived rather than carried from the sample, so the stored label
    // always matches the stored centipawn loss.
    const cls = classifyCp(cpLoss);

    const evalBefore = evalWhite;
    // A mistake always moves the evaluation against whoever made it.
    evalWhite = Math.max(-950, Math.min(950, evalWhite + (p.moverIsWhite ? -cpLoss : cpLoss)));

    const side = p.moverIsWhite ? "w" : "b";
    const spend = Math.max(1, Math.round((base / 42) * (0.35 + rng() * 1.6)));
    clocks[side] = Math.max(2, clocks[side] - spend + spec.increment);
    const clockSeconds = clocks[side];

    const record = {
      gameId: spec.id,
      ply: p.ply,
      sideToMove: p.mover,
      fenBefore: p.fenBefore,
      san: p.san,
      uci: p.uci,
      evalBeforeCp: evalBefore,
      evalAfterCp: evalWhite,
      bestMoveUci: p.playedIsBest ? p.uci : p.bestUci,
      bestMoveSan: p.playedIsBest ? p.san : p.bestSan,
      centipawnLoss: cpLoss,
      classification: cls,
      gamePhase: p.phase,
      clockSeconds,
      timePressureBand: bandFor(clockSeconds, base),
    };
    if (cls === "best") record.moveRank = 1;
    else if (cls === "excellent") record.moveRank = 2;
    else if (cls === "good") record.moveRank = randInt(rng, 3, 5);
    const tag = blunderTagFor(rng, cls);
    if (tag) record.blunderTag = tag;

    records.push(record);

    if (p.isUser) {
      peakUserCp = Math.max(peakUserCp, spec.userColor === "white" ? evalBefore : -evalBefore);
    }
  }

  const finalUserCp = spec.userColor === "white" ? evalWhite : -evalWhite;
  return { records, peakUserCp, finalUserCp };
}

/** A game that ends with the player winning on the board but recorded as a
 * loss reads as broken data. Resignations and flags are not that tidy in
 * reality, so this is a loose agreement check, not an exact one. */
function resultAgreesWithEval(result, finalUserCp) {
  if (result === "win") return finalUserCp >= 150;
  if (result === "loss") return finalUserCp <= -150;
  return Math.abs(finalUserCp) <= 250;
}

function toPgn(spec, chess) {
  const date = new Date(spec.endTime * 1000);
  const stamp = `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(date.getUTCDate()).padStart(2, "0")}`;
  const resultTag =
    spec.userResult === "draw" ? "1/2-1/2" : (spec.userResult === "win") === (spec.userColor === "white") ? "1-0" : "0-1";
  chess.header(
    "Event", "Live Chess (sample data)",
    "Site", "Chegga demo",
    "Date", stamp,
    "White", spec.white,
    "Black", spec.black,
    "Result", resultTag,
    "ECO", spec.book.eco,
    "Opening", spec.book.name,
    "TimeControl", spec.timeControl,
  );
  return chess.pgn();
}

// --- the dataset ---

// Chronological. The result column is deliberate: five losses in a row
// (games 5-9) so the tilt card has a real streak to name, and two games the
// player reached a winning position in and did not win.
// Lengths vary on purpose: a couple of short, sharp losses, but enough long
// games that pieces actually come off and the endgame bucket fills. Without
// those, every move lands in opening/middlegame and the strength model reads
// a flat 0 for endgame accuracy — which is not "good endgames", it is no data.
const SCRIPT = [
  { month: "2026-06", day: 3,  hour: 19, result: "win",  book: 0, color: "white", tc: "600",    plies: 74, thrown: false },
  { month: "2026-06", day: 3,  hour: 20, result: "loss", book: 1, color: "black", tc: "600",    plies: 58, thrown: false },
  { month: "2026-06", day: 11, hour: 21, result: "win",  book: 4, color: "white", tc: "300",    plies: 96, thrown: false },
  { month: "2026-06", day: 11, hour: 22, result: "draw", book: 2, color: "black", tc: "300",    plies: 82, thrown: false },
  { month: "2026-06", day: 19, hour: 20, result: "loss", book: 3, color: "white", tc: "900+10", plies: 70, thrown: true  },
  { month: "2026-07", day: 2,  hour: 19, result: "loss", book: 5, color: "black", tc: "600",    plies: 52, thrown: false },
  { month: "2026-07", day: 2,  hour: 20, result: "loss", book: 6, color: "white", tc: "600",    plies: 44, thrown: false },
  { month: "2026-07", day: 2,  hour: 21, result: "loss", book: 7, color: "black", tc: "600",    plies: 88, thrown: false },
  { month: "2026-07", day: 14, hour: 20, result: "loss", book: 8, color: "white", tc: "180",    plies: 46, thrown: false },
  { month: "2026-07", day: 21, hour: 19, result: "win",  book: 9, color: "black", tc: "600",    plies: 78, thrown: false },
  { month: "2026-07", day: 21, hour: 20, result: "win",  book: 0, color: "white", tc: "600",    plies: 62, thrown: false },
  { month: "2026-08", day: 5,  hour: 21, result: "loss", book: 2, color: "white", tc: "900+10", plies: 90, thrown: true  },
  { month: "2026-08", day: 12, hour: 20, result: "draw", book: 3, color: "black", tc: "600",    plies: 86, thrown: false },
  { month: "2026-08", day: 23, hour: 19, result: "win",  book: 5, color: "white", tc: "600",    plies: 68, thrown: false },
];

function errorScriptFor(entry, targetPlies) {
  const climbEnds = Math.round(targetPlies * 0.62);
  return (ply, isUser) => {
    if (entry.thrown) {
      // Opponent hands over a winning position, then the player gives it back.
      if (ply <= climbEnds) return isUser ? "steady" : "sloppy";
      return isUser ? "sloppy" : "steady";
    }
    if (entry.result === "win") return isUser ? "steady" : "sloppy";
    if (entry.result === "loss") return isUser ? "sloppy" : "steady";
    return "steady";
  };
}

function build() {
  const games = [];
  const moveAnalysis = [];

  SCRIPT.forEach((entry, i) => {
    const [y, m] = entry.month.split("-").map(Number);
    const endTime = Math.floor(Date.UTC(y, m - 1, entry.day, entry.hour, 35, 0) / 1000);
    const book = BOOK[entry.book];
    const opponent = OPPONENTS[i % OPPONENTS.length];
    const [baseStr, incStr] = entry.tc.split("+");
    const baseSeconds = Number(baseStr);
    const increment = Number(incStr ?? 0);
    const userColor = entry.color;

    const spec = {
      id: `demo-game-${String(i + 1).padStart(2, "0")}`,
      book,
      userColor,
      endTime,
      targetPlies: entry.plies,
      baseSeconds,
      increment,
      timeControl: entry.tc,
      userResult: entry.result,
      thrown: entry.thrown,
      white: userColor === "white" ? DEMO_USERNAME : opponent,
      black: userColor === "white" ? opponent : DEMO_USERNAME,
      errorScript: errorScriptFor(entry, entry.plies),
    };

    const played = playGame(spec, 0x21a7 + i * 1009);

    // A decisive game ends on the winner's move — otherwise the PGN reads as
    // the loser checking their opponent and then resigning.
    if (entry.result !== "draw") {
      const winner = entry.result === "win" ? userColor : userColor === "white" ? "black" : "white";
      while (played.plies.length > 20 && played.plies[played.plies.length - 1].mover !== winner) {
        played.plies.pop();
        played.chess.undo();
      }
    }

    // The opponent's collapse in a "thrown" game is pinned to real plies
    // rather than left to the sampler, so the player demonstrably reaches a
    // winning position; the cheap scoring pass is still retried in case the
    // player's own sampled errors eat the whole advantage back.
    const climbEnd = Math.round(played.plies.length * 0.62);
    const forced = new Set();
    if (entry.thrown) {
      const oppPlies = played.plies.filter((p) => !p.isUser && !p.isBook && p.ply <= climbEnd).map((p) => p.ply);
      for (const frac of [0.25, 0.55, 0.85]) {
        const at = oppPlies[Math.floor(oppPlies.length * frac)];
        if (at !== undefined) forced.add(at);
      }
    }

    let scored;
    let accepted = false;
    for (let attempt = 0; attempt < 400; attempt++) {
      scored = scoreGame(played.plies, spec, 0x5f3a + i * 1009 + attempt * 7919, forced);
      const climbed = !entry.thrown || scored.peakUserCp >= 320;
      if (climbed && resultAgreesWithEval(entry.result, scored.finalUserCp)) {
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      throw new Error(
        `${spec.id}: no scoring pass matched the script (result ${entry.result}, final ${scored.finalUserCp}cp, peak ${scored.peakUserCp}cp)`,
      );
    }
    const built = { moves: scored.records, chess: played.chess };

    const rng = mulberry32(0x9e37 + i);
    const userRating = 1520 + randInt(rng, -60, 70);
    const oppRating = userRating + randInt(rng, -120, 130);

    games.push({
      chessComUuid: spec.id,
      username: DEMO_USERNAME,
      url: "",
      pgn: toPgn(spec, built.chess),
      timeControl: entry.tc,
      timeClass: baseSeconds >= 600 ? "rapid" : "blitz",
      rules: "chess",
      rated: true,
      endTime,
      eco: book.eco,
      openingName: book.name,
      whiteUsername: spec.white,
      whiteRating: userColor === "white" ? userRating : oppRating,
      blackUsername: spec.black,
      blackRating: userColor === "white" ? oppRating : userRating,
      whiteResult: resultCode(entry.result, userColor === "white"),
      blackResult: resultCode(entry.result, userColor === "black"),
      userColor,
      userResult: entry.result,
      analyzed: true,
    });
    moveAnalysis.push(...built.moves);
  });

  const months = [...new Set(SCRIPT.map((e) => e.month))];
  const syncState = months.map((ym) => ({
    username: DEMO_USERNAME,
    yearMonth: ym,
    status: "complete",
    gamesFetched: SCRIPT.filter((e) => e.month === ym).length,
    lastSyncedAt: Date.UTC(2026, 8, 1) ,
  }));

  return {
    formatVersion: 4,
    exportedAt: Date.UTC(2026, 8, 1),
    games,
    moveAnalysis,
    syncState,
    skillSnapshots: [],
    rivalSnapshots: [],
    savedPuzzles: [],
  };
}

function resultCode(userResult, isThisSide) {
  if (userResult === "draw") return "agreed";
  const won = userResult === "win" ? isThisSide : !isThisSide;
  return won ? "win" : "resigned";
}

// --- self-checks: every PGN re-parses, every growth-card gate passes ---

function checkGates(data) {
  const problems = [];
  const own = data.moveAnalysis.filter((m) => {
    const g = data.games.find((x) => x.chessComUuid === m.gameId);
    return g && m.sideToMove === g.userColor;
  });

  for (const g of data.games) {
    const replay = new Chess();
    replay.loadPgn(g.pgn);
    const plies = data.moveAnalysis.filter((m) => m.gameId === g.chessComUuid).length;
    if (replay.history().length !== plies) {
      problems.push(`${g.chessComUuid}: PGN has ${replay.history().length} moves but ${plies} analysis records`);
    }
  }

  const mislabelled = data.moveAnalysis.filter((m) => classifyCp(m.centipawnLoss) !== m.classification);
  if (mislabelled.length > 0) {
    const e = mislabelled[0];
    problems.push(`${mislabelled.length} move(s) carry a label the app's own classify() disagrees with (e.g. ${e.centipawnLoss}cp stored as "${e.classification}", should be "${classifyCp(e.centipawnLoss)}")`);
  }

  const rated = data.games.filter((g) => g.rated);
  if (rated.length < 10) problems.push(`Consistency gate: only ${rated.length} rated games (needs >= 10)`);

  let streak = 0;
  let longest = 0;
  for (const g of [...rated].sort((a, b) => a.endTime - b.endTime)) {
    streak = g.userResult === "loss" ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  if (longest < 5) problems.push(`Consistency gate: longest loss streak is ${longest} (needs >= 5 for a real recommendation)`);

  const monthOf = (s) => {
    const d = new Date(s * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const byMonth = new Map();
  for (const m of own) {
    const g = data.games.find((x) => x.chessComUuid === m.gameId);
    const key = monthOf(g.endTime);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  const plottable = [...byMonth.entries()].filter(([, n]) => n >= 20);
  if (plottable.length < 2) {
    problems.push(`Blunder-rate gate: ${plottable.length} month(s) with >= 20 own moves (needs >= 2 for a trend)`);
  }

  const peakOf = (g) => {
    const ms = own.filter((m) => m.gameId === g.chessComUuid);
    if (ms.length < 8) return -Infinity;
    return Math.max(...ms.map((m) => (g.userColor === "white" ? m.evalBeforeCp : -m.evalBeforeCp)));
  };
  const thrown = data.games.filter((g) => g.userResult !== "win" && peakOf(g) >= 250);
  if (thrown.length === 0) problems.push("Convert-the-win gate: no non-win game reaches +2.5 from the player's side");

  // An eval pinned at the clamp means error accumulated unchecked. The
  // convert-the-win card then lists several games all peaking at the same
  // absurd number, which reads as a bug rather than as a bad day.
  const saturated = data.moveAnalysis.filter((m) => Math.abs(m.evalBeforeCp) >= 850);
  if (saturated.length > 0) {
    const ids = [...new Set(saturated.map((m) => m.gameId))];
    problems.push(`${saturated.length} move(s) across ${ids.length} game(s) sit at the eval clamp (${ids.join(", ")}) — error is accumulating instead of mean-reverting`);
  }

  const featurable = data.games.filter((g) => own.filter((m) => m.gameId === g.chessComUuid).length >= 5);
  if (featurable.length === 0) problems.push("Road-to-target gate: no game has >= 5 own moves");

  const blunders = own.filter((m) => m.classification === "blunder").length;
  if (blunders === 0) problems.push("No blunders at all — the puzzle trainer and redemption list would both be empty");

  // Every phase needs moves in it. A phase with none reads to the strength
  // model as a flat 0 average — i.e. flawless play — not as missing data.
  const phases = {};
  for (const m of own) phases[m.gamePhase] = (phases[m.gamePhase] ?? 0) + 1;
  for (const phase of ["opening", "middlegame", "endgame"]) {
    if (!phases[phase] || phases[phase] < 10) {
      problems.push(`Phase coverage: only ${phases[phase] ?? 0} own ${phase} moves (needs >= 10)`);
    }
  }

  // The "Road to a target rating" card drops any area worth under 3 model
  // points. Against the frozen model at its default 2000 target, blunder rate
  // is the only area that clears that bar, and only above ~11.2% — so a demo
  // player who barely blunders produces a card with no factors at all.
  const blunderRate = blunders / own.length;
  if (blunderRate < 0.115 || blunderRate > 0.16) {
    problems.push(`Own blunder rate is ${(blunderRate * 100).toFixed(1)}% — wanted 11.5-16% (below it the Road card shows no factors at its default target; above it stops being plausible)`);
  }

  return { problems, own, thrown, plottable, longest, blunders, phases };
}

const data = build();
const { problems, own, thrown, plottable, longest, blunders, phases } = checkGates(data);

if (problems.length > 0) {
  console.error("Demo dataset failed its own gates:\n" + problems.map((p) => `  - ${p}`).join("\n"));
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(data));

const kb = (JSON.stringify(data).length / 1024).toFixed(0);
console.log(`Wrote ${OUT}`);
console.log(`  ${data.games.length} games, ${data.moveAnalysis.length} analysed moves (${own.length} the player's own), ${kb} KB`);
console.log(`  months plottable for blunder rate: ${plottable.map(([m, n]) => `${m} (${n})`).join(", ")}`);
console.log(`  longest loss streak: ${longest}; thrown games: ${thrown.length}; own blunders: ${blunders} (${((blunders / own.length) * 100).toFixed(1)}%)`);
console.log(`  own moves by phase: ${Object.entries(phases).map(([p, n]) => `${p} ${n}`).join(", ")}`);
console.log(`  all ${data.games.length} PGNs re-parse and match their analysis records`);
