import { test, expect, type Page } from "@playwright/test";

// The Insights card's weak-opening line ("Your play is weakest in ...")
// used to be a fact with no lever -- no link to the games it happened in,
// no link to the actual position (chegga-2026-08-29 #5 / chegga-2026-09-03
// #7). This spec seeds two games in the same opening (one with a real
// costliest opening-phase move) plus one game in a different opening, and
// checks both new jump buttons actually land where they claim to:
// filtered games in the picker, and the specific worst position in review.
//
// Runs against the local build (see playwright.config.ts). Chess.com is
// stubbed so nothing depends on the network. Move-analysis records are
// hand-seeded (not run through the real WASM engine) so the test is fast
// and deterministic -- the point here is the wiring between the Insights
// card, the game picker, and the review screen, not engine correctness
// (already covered by review-picker.spec.ts and the vitest suite).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chegga-web:tutorial", "done");
    } catch {
      // blocked storage: the tutorial does not show then either
    }
  });
});

const FRENCH = "French Defense: Advance Variation";
const ITALIAN = "Italian Game";

function frenchGame(uuid: string): any {
  return {
    chessComUuid: uuid,
    username: "tester",
    url: "",
    pgn: "1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. e5 Nfd7 5. f4 c5 6. Nf3 Nc6 0-1",
    timeControl: "600",
    timeClass: "rapid",
    rules: "chess",
    rated: true,
    endTime: 1_780_000_000,
    openingName: FRENCH,
    whiteUsername: "tester",
    whiteRating: 1400,
    blackUsername: "rival",
    blackRating: 1420,
    whiteResult: "resigned",
    blackResult: "win",
    userColor: "white",
    userResult: "loss",
    analyzed: true,
  };
}

// White's own moves at ply 1,3,5,7,9,11 -- ply 5 (3. Nc3) is seeded as the
// costliest opening-phase move, well above everything else including a
// deliberately larger middlegame loss at ply 11, which the "review the key
// position" jump must NOT pick (worstPositionInOpening only looks at
// gamePhase === "opening").
function frenchMoves(gameId: string, worstCpLoss: number): any[] {
  return [
    { gameId, ply: 1, sideToMove: "white", fenBefore: "", san: "e4", uci: "e2e4", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
    { gameId, ply: 3, sideToMove: "white", fenBefore: "", san: "d4", uci: "d2d4", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
    {
      gameId,
      ply: 5,
      sideToMove: "white",
      fenBefore: "",
      san: "Nc3",
      uci: "b1c3",
      centipawnLoss: worstCpLoss,
      classification: worstCpLoss > 100 ? "blunder" : "good",
      gamePhase: "opening",
      bestMoveSan: "Nf3",
      bestMoveUci: "g1f3",
    },
    { gameId, ply: 7, sideToMove: "white", fenBefore: "", san: "e5", uci: "e4e5", centipawnLoss: 5, classification: "excellent", gamePhase: "opening" },
    { gameId, ply: 9, sideToMove: "white", fenBefore: "", san: "f4", uci: "f2f4", centipawnLoss: 5, classification: "excellent", gamePhase: "opening" },
    // Bigger raw loss, but middlegame -- must be ignored by the "key position" jump.
    { gameId, ply: 11, sideToMove: "white", fenBefore: "", san: "Nf3", uci: "g1f3", centipawnLoss: 999, classification: "blunder", gamePhase: "middlegame" },
  ];
}

const ITALIAN_GAME = {
  chessComUuid: "it-1",
  username: "tester",
  url: "",
  pgn: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 *",
  timeControl: "600",
  timeClass: "rapid",
  rules: "chess",
  rated: true,
  endTime: 1_780_000_100,
  openingName: ITALIAN,
  whiteUsername: "tester",
  whiteRating: 1400,
  blackUsername: "other",
  blackRating: 1390,
  whiteResult: "win",
  blackResult: "resigned",
  userColor: "white",
  userResult: "win",
  analyzed: true,
};

const ITALIAN_MOVES = [
  { gameId: "it-1", ply: 1, sideToMove: "white", fenBefore: "", san: "e4", uci: "e2e4", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
  { gameId: "it-1", ply: 3, sideToMove: "white", fenBefore: "", san: "Nf3", uci: "g1f3", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
];

async function seedAndLoad(page: Page) {
  await page.route("https://api.chess.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ archives: [] }) }),
  );
  await page.goto("/");
  await page.waitForTimeout(800); // let the app create its DB

  const games = [frenchGame("fr-1"), frenchGame("fr-2"), ITALIAN_GAME];
  games[1].chessComUuid = "fr-2";
  games[1].endTime = 1_780_000_050;
  games[1].userResult = "win";
  games[1].whiteResult = "win";
  games[1].blackResult = "resigned";
  games[1].pgn = "1. e4 e6 2. d4 d5 3. exd5 exd5 4. Nf3 Nf6 5. Bd3 Bd6 6. O-O O-O *";

  const fr2Moves = [
    { gameId: "fr-2", ply: 1, sideToMove: "white", fenBefore: "", san: "e4", uci: "e2e4", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
    { gameId: "fr-2", ply: 3, sideToMove: "white", fenBefore: "", san: "d4", uci: "d2d4", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
    { gameId: "fr-2", ply: 5, sideToMove: "white", fenBefore: "", san: "exd5", uci: "e4d5", centipawnLoss: 20, classification: "good", gamePhase: "opening" },
    { gameId: "fr-2", ply: 7, sideToMove: "white", fenBefore: "", san: "Nf3", uci: "g1f3", centipawnLoss: 10, classification: "good", gamePhase: "opening" },
    { gameId: "fr-2", ply: 9, sideToMove: "white", fenBefore: "", san: "Bd3", uci: "f1d3", centipawnLoss: 5, classification: "excellent", gamePhase: "opening" },
    { gameId: "fr-2", ply: 11, sideToMove: "white", fenBefore: "", san: "O-O", uci: "e1g1", centipawnLoss: 0, classification: "best", gamePhase: "opening" },
  ];

  const moves = [...frenchMoves("fr-1", 250), ...fr2Moves, ...ITALIAN_MOVES];

  await page.evaluate(
    async ({ games, moves }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("chegga-web");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["games", "moveAnalysis"], "readwrite");
          for (const g of games) tx.objectStore("games").put(g);
          for (const m of moves) tx.objectStore("moveAnalysis").put(m);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
      localStorage.setItem("chegga-web:last-username", "tester");
    },
    { games, moves },
  );
  // The hash both auto-fills the username on this fresh load and expands
  // the "Coming soon"-gated Insights card straight past its gate. The
  // reload is load-bearing: a goto that changes only the hash is an
  // in-page navigation, so the startup path that restores the username
  // and calls refreshProfile would never re-run.
  await page.goto("/#u=tester&open=insights-section");
  await page.reload();
}

test.describe("opening weakness -> action", () => {
  test.setTimeout(60_000);

  test("names the weak opening with a real 'do this': filtered games + the key position", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await seedAndLoad(page);

    const insightsOutput = page.locator("#insights-output");
    await expect(insightsOutput).toContainText(FRENCH, { timeout: 15_000 });

    const openingItem = insightsOutput.locator(".insight-item", { hasText: FRENCH });
    const gamesBtn = openingItem.locator("[data-open-games-opening]");
    const worstBtn = openingItem.locator("[data-review-worst-game]");
    await expect(gamesBtn).toHaveText("See these games ↓");
    await expect(worstBtn).toHaveText("Review the key position ↓");
    // The button carries the actual worst position, not just the game.
    await expect(worstBtn).toHaveAttribute("data-review-worst-game", "fr-1");
    await expect(worstBtn).toHaveAttribute("data-review-worst-ply", "5");

    // --- "See these games": the picker narrows to exactly this opening ---
    await gamesBtn.click();
    await expect(page.locator("#picker-section")).toBeInViewport();
    await expect(page.locator(".picker-opening-focus")).toContainText(FRENCH);
    const cards = page.locator("#picker-section .picker-card");
    await expect(cards).toHaveCount(2);
    await expect(page.locator("#picker-section")).not.toContainText(ITALIAN);
    await expect(page.locator("#picker-section")).toContainText("rival"); // both French games' opponent

    // Clearing it goes back to every synced game.
    await page.locator("[data-picker-clear-opening]").click();
    await expect(cards).toHaveCount(3);
    await expect(page.locator(".picker-opening-focus")).toHaveCount(0);

    // --- "Review the key position": opens fr-1 straight on ply 5 (3. Nc3) ---
    await worstBtn.click();
    await expect(page.locator("#review-panel")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#review-caption")).toContainText("3. Nc3");
    await expect(page.locator("#review-caption")).toContainText("Blunder");
    await expect(page.locator("#review-caption")).toContainText("250cp lost");
    // Not the middlegame move seeded with the bigger (but out-of-scope)
    // loss -- that one is White's 6th move and cost 999cp. Matching on the
    // bare SAN "Nf3" would be wrong here: ply 5's own caption names Nf3 as
    // the move the engine preferred.
    await expect(page.locator("#review-caption")).not.toContainText("6. Nf3");
    await expect(page.locator("#review-caption")).not.toContainText("999cp");

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
