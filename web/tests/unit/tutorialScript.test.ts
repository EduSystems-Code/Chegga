import { describe, it, expect } from "vitest";
import { buildBeats, describePosition, explainWhyBest, lineOutcome, nudgeLine } from "../../src/tutorialScript";
import type { TeachableMoment } from "../../src/tutorialMoment";
import type { AnalysisLine } from "../../src/engine";

// After 1.e4 e5 2.Qh5 Nc6, White to move.
const AFTER_QH5_NC6 = "r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3";
// White to move; Black's knight on d5 is attacked by the e4 pawn and not defended.
const LOOSE_KNIGHT = "rnbqkb1r/pppppppp/8/3n4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1";
// After 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 -- Qxf7 is checkmate.
const MATE_IN_ONE = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

function moment(over: Partial<TeachableMoment> = {}): TeachableMoment {
  return {
    id: "g:5",
    gameId: "g",
    opponent: "rival",
    endTime: 1_780_000_000,
    userColor: "white",
    ply: 5,
    moveNumber: 3,
    fenBefore: AFTER_QH5_NC6,
    playedSan: "Qxe5+",
    playedUci: "h5e5",
    bestSan: "Bc4",
    bestUci: "f1c4",
    centipawnLoss: 620,
    classification: "blunder",
    blunderTag: "hung_material",
    gamePhase: "opening",
    isExample: false,
    ...over,
  };
}

const line = (scoreCp: number, pv: string[], scoreMate?: number): AnalysisLine => ({ multipv: 1, depth: 13, scoreCp, scoreMate, pv });

describe("describePosition", () => {
  it("says who is playing and that material is even", () => {
    expect(describePosition(AFTER_QH5_NC6, "white")).toEqual([
      "You are playing White, and it is your move.",
      "Material is even.",
    ]);
  });

  it("points out an opponent piece that is under attack and loose", () => {
    const lines = describePosition(LOOSE_KNIGHT, "white");
    expect(lines).toContain("Your opponent's knight on d5 is under attack and not fully protected.");
  });

  it("warns about the player's own loose piece when the opponent has none", () => {
    const lines = describePosition(LOOSE_KNIGHT, "black");
    expect(lines).toContain("Watch your knight on d5: it is under attack and not fully protected.");
  });

  it("says when the player is ahead or behind", () => {
    const upAPiece = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1"; // White has no g1 knight
    expect(describePosition(upAPiece, "black")).toContain("You are ahead by a piece.");
    expect(describePosition(upAPiece, "white")).toContain("You are behind by a piece.");
  });
});

describe("lineOutcome", () => {
  it("counts material won along the line", () => {
    const out = lineOutcome(LOOSE_KNIGHT, ["e4d5"]);
    expect(out).toEqual({ sanLine: ["exd5"], gain: 3, mate: false });
  });

  it("counts material lost as well as won", () => {
    // After 1.e4 d5: exd5 wins a pawn, Qxd5 wins it back.
    const afterE4D5 = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    expect(lineOutcome(afterE4D5, ["e4d5", "d8d5"])).toEqual({ sanLine: ["exd5", "Qxd5"], gain: 0, mate: false });
  });

  it("recognizes a line that ends in mate", () => {
    expect(lineOutcome(MATE_IN_ONE, ["h5f7"]).mate).toBe(true);
    expect(lineOutcome(MATE_IN_ONE, ["h5f7"]).sanLine).toEqual(["Qxf7#"]);
  });

  it("stops at a move that does not fit, without throwing", () => {
    expect(lineOutcome(LOOSE_KNIGHT, ["e4d5", "a1a8"]).sanLine).toEqual(["exd5"]);
    expect(lineOutcome(LOOSE_KNIGHT, [])).toEqual({ sanLine: [], gain: 0, mate: false });
  });
});

describe("explainWhyBest", () => {
  it("names what the best move does and how the engine rates the position", () => {
    const lines = explainWhyBest(moment(), [line(20, ["f1c4", "g8f6", "d2d3"])]);
    expect(lines[0]).toBe("Bc4 develops your bishop.");
    expect(lines[1]).toBe("The engine rates the position about equal after it.");
  });

  it("says a line ends in checkmate", () => {
    const m = moment({ fenBefore: MATE_IN_ONE, bestSan: "Qxf7#", bestUci: "h5f7", gamePhase: "opening" });
    const lines = explainWhyBest(m, [line(0, ["h5f7"], 0)]);
    expect(lines[0]).toBe("Qxf7# delivers checkmate.");
    expect(lines[1]).toBe("Follow the engine's line (Qxf7#) and it ends in checkmate.");
  });

  it("says a line wins material", () => {
    const m = moment({ fenBefore: LOOSE_KNIGHT, bestSan: "exd5", bestUci: "e4d5", gamePhase: "opening" });
    const lines = explainWhyBest(m, [line(300, ["e4d5", "e7e6", "d2d4"])]);
    expect(lines[0]).toBe("exd5 captures the knight on d5.");
    expect(lines[1]).toBe("Follow the engine's line (exd5 e6 d4) and you come out a piece ahead.");
  });

  it("still says something when there is no deeper line", () => {
    expect(explainWhyBest(moment({ gamePhase: "middlegame" }), [])).toEqual(["Bc4 is the engine's top choice here."]);
  });

  it("does not describe a line that starts with a different move", () => {
    const lines = explainWhyBest(moment(), [line(20, ["b1c3"])]);
    expect(lines).toHaveLength(1);
  });
});

describe("buildBeats", () => {
  const deep = [line(20, ["f1c4", "g8f6"])];
  const beats = buildBeats(moment(), deep, { site: "chesscom", dateLabel: "May 28", shadedCount: 3 });

  it("runs the beats in the order the tutorial plays them", () => {
    expect(beats.map((b) => b.id)).toEqual(["intro", "position", "heatmap", "whyBest", "yourTurn", "played", "whatItDoes"]);
  });

  it("opens with the player's own game, and holds the answer back", () => {
    expect(beats[0].lines[0]).toBe("I found a move worth a second look in your game against rival, played May 28.");
    expect(beats[0].lines[1]).toBe("On move 3, playing White, you had a better move than the one you played.");
    expect(beats[0].lines.join(" ")).not.toContain("Bc4");
    expect(beats[1].lines.join(" ")).not.toContain("Bc4");
  });

  it("counts the shaded moves", () => {
    expect(beats[2].lines).toContain("3 moves are shaded here.");
    const single = buildBeats(moment(), deep, { shadedCount: 1 });
    expect(single[2].lines).toContain("Only one move is shaded here.");
  });

  it("names the answer only from 'why it is best' onward", () => {
    expect(beats[3].title).toBe("Why Bc4 is best");
    expect(beats[4].lines[0]).toBe("Play Bc4. Move the piece on f1 to c4.");
  });

  it("says what was played in the game, and why it was worse", () => {
    const text = beats[5].lines.join(" ");
    expect(text).toContain("In your game you played Qxe5+.");
    expect(text).toContain("leaves your queen on e5 open to capture");
  });

  it("explains the app, naming the site the games came from", () => {
    const text = beats[6].lines.join(" ");
    expect(text).toContain("Chess.com");
    expect(text).toContain("no password");
    expect(text).toContain("any game you have played, at any move");
    expect(text).toContain("I saved this position");
  });

  it("says Lichess when the games came from Lichess", () => {
    const lichess = buildBeats(moment(), deep, { site: "lichess", shadedCount: 2 });
    expect(lichess[6].lines.join(" ")).toContain("Lichess");
  });

  it("frames the example game as an example, and invites connecting an account", () => {
    const example = buildBeats(moment({ isExample: true }), deep, { shadedCount: 1 });
    expect(example[0].lines[0]).toContain("example game");
    expect(example[5].lines[0]).toBe("In the example game, White played Qxe5+ instead.");
    expect(example[6].lines.join(" ")).toContain("Connect your username");
    expect(example[6].lines.join(" ")).not.toContain("I saved this position");
  });

  it("says why the example is shown when the visitor's own games held nothing to teach from", () => {
    const example = buildBeats(moment({ isExample: true }), deep, {
      shadedCount: 1,
      exampleNote: "I did not find a clear missed move in your latest games.",
    });
    expect(example[0].lines[0]).toBe("I did not find a clear missed move in your latest games.");
    expect(example[0].lines[1]).toContain("example game");
  });

  it("nudges toward the asked-for move when a different legal move is played", () => {
    expect(nudgeLine("Nc3", moment())).toBe(
      "Nc3 is a legal move, but it is not the one I am asking for. Try Bc4: the piece on f1 goes to c4.",
    );
  });
});
