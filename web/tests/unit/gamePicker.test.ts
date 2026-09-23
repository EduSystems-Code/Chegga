import { describe, it, expect } from "vitest";
import { buildPickerCards, pickerCounts, toPickerCard } from "../../src/gamePicker";
import { game } from "./_factories";

const games = [
  game({ chessComUuid: "old-win", endTime: 1000, userResult: "win", analyzed: true, pgn: "1. e4 *" }),
  game({ chessComUuid: "mid-loss", endTime: 2000, userResult: "loss", analyzed: false, pgn: "1. d4 *" }),
  game({ chessComUuid: "new-draw", endTime: 3000, userResult: "draw", analyzed: true, pgn: "1. c4 *" }),
  game({ chessComUuid: "variant", endTime: 2500, userResult: "win", rules: "chess960", analyzed: false, pgn: "1. e4 *" }),
];

describe("buildPickerCards", () => {
  it("lists the newest game first", () => {
    expect(buildPickerCards(games, "all").map((c) => c.id)).toEqual(["new-draw", "variant", "mid-loss", "old-win"]);
  });

  it("filters by result", () => {
    expect(buildPickerCards(games, "loss").map((c) => c.id)).toEqual(["mid-loss"]);
    expect(buildPickerCards(games, "win").map((c) => c.id)).toEqual(["variant", "old-win"]);
  });

  it("filters to analyzed games", () => {
    expect(buildPickerCards(games, "analyzed").map((c) => c.id)).toEqual(["new-draw", "old-win"]);
  });

  it("caps the number of cards", () => {
    expect(buildPickerCards(games, "all", 2).map((c) => c.id)).toEqual(["new-draw", "variant"]);
  });

  it("narrows to one opening line on top of the result filter", () => {
    const withOpenings = [
      game({ chessComUuid: "fr-1", endTime: 1000, userResult: "win", openingName: "French Defense" }),
      game({ chessComUuid: "fr-2", endTime: 2000, userResult: "loss", openingName: "French Defense" }),
      game({ chessComUuid: "sic-1", endTime: 3000, userResult: "win", openingName: "Sicilian Defense" }),
    ];
    expect(buildPickerCards(withOpenings, "all", 60, "French Defense").map((c) => c.id)).toEqual(["fr-2", "fr-1"]);
    expect(buildPickerCards(withOpenings, "win", 60, "French Defense").map((c) => c.id)).toEqual(["fr-1"]);
  });
});

describe("toPickerCard", () => {
  it("names the opponent and ratings from the user's side of the board", () => {
    const asWhite = toPickerCard(
      game({ userColor: "white", whiteUsername: "me", whiteRating: 1500, blackUsername: "them", blackRating: 1620 }),
    );
    expect(asWhite).toMatchObject({ opponent: "them", opponentRating: 1620, yourRating: 1500, color: "white" });
    const asBlack = toPickerCard(
      game({ userColor: "black", whiteUsername: "them", whiteRating: 1620, blackUsername: "me", blackRating: 1500 }),
    );
    expect(asBlack).toMatchObject({ opponent: "them", opponentRating: 1620, yourRating: 1500, color: "black" });
  });

  it("marks a variant or empty-PGN game as not openable", () => {
    expect(toPickerCard(games[3]).supported).toBe(false);
    expect(toPickerCard(game({ pgn: "" })).supported).toBe(false);
    expect(toPickerCard(games[0]).supported).toBe(true);
  });
});

describe("pickerCounts", () => {
  it("counts each filter", () => {
    expect(pickerCounts(games)).toEqual({ all: 4, win: 2, loss: 1, draw: 1, analyzed: 2 });
  });

  it("counts within an opening filter, not the whole set", () => {
    const withOpenings = [
      game({ chessComUuid: "fr-1", userResult: "win", analyzed: true, openingName: "French Defense" }),
      game({ chessComUuid: "fr-2", userResult: "loss", analyzed: false, openingName: "French Defense" }),
      game({ chessComUuid: "sic-1", userResult: "win", analyzed: true, openingName: "Sicilian Defense" }),
    ];
    expect(pickerCounts(withOpenings, "French Defense")).toEqual({ all: 2, win: 1, loss: 1, draw: 0, analyzed: 1 });
  });
});
