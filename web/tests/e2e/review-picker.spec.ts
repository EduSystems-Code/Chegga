import { test, expect, type Page } from "@playwright/test";

// These specs are about the page itself, not the first-run tutorial (see
// tutorial.spec.ts), so they start as a visitor who has already been through it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chegga-web:tutorial", "done");
    } catch {
      // blocked storage: the tutorial does not show then either
    }
  });
});


// Picker -> review -> reasons -> best-move heatmap -> practice -> saved
// positions, against a real (seeded) synced game and the real WASM engine.
// Runs against the local build (see playwright.config.ts). The Chess.com
// API is stubbed so nothing depends on the network.
//
// The seeded game is one where White (the reviewer) hangs the queen on move
// 3 (3.Qxe5+?? Nxe5), so there is a certain, explainable blunder to find.

const PGN =
  "1. e4 e5 2. Qh5 Nc6 3. Qxe5+ Nxe5 4. d4 Nc6 5. d5 Nb8 6. Nc3 Nf6 7. Bg5 Be7 8. Bxf6 Bxf6 0-1";

const GAME = {
  chessComUuid: "e2e-picker-1",
  username: "tester",
  url: "",
  pgn: PGN,
  timeControl: "600",
  timeClass: "rapid",
  rules: "chess",
  rated: true,
  endTime: 1_780_000_000,
  openingName: "Bongcloud-ish Queen Grab",
  whiteUsername: "tester",
  whiteRating: 1200,
  blackUsername: "rival",
  blackRating: 1250,
  whiteResult: "resigned",
  blackResult: "win",
  userColor: "white",
  userResult: "loss",
  analyzed: false,
};

async function seedAndLoad(page: Page) {
  await page.route("https://api.chess.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ archives: [] }) }),
  );
  await page.goto("/");
  await page.waitForTimeout(800); // let the app create its DB
  await page.evaluate(async (game) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("chegga-web");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("games", "readwrite");
        tx.objectStore("games").put(game);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    localStorage.setItem("chegga-web:last-username", "tester");
  }, GAME);
  await page.reload();
}

async function playMove(page: Page, from: string, to: string) {
  await page.locator(`#play-board-wrap [data-square="${from}"]`).click();
  await page.locator(`#play-board-wrap [data-square="${to}"]`).click();
}

test.describe("game picker and review", () => {
  test.setTimeout(150_000);

  test("picks a synced game, explains the blunder, shades the best moves, practices, saves", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await seedAndLoad(page);

    // --- the picker shows the game as a card ---
    const card = page.locator("#picker-section .picker-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Loss");
    await expect(card).toContainText("rival");
    await expect(card).toContainText("Analyze & review");

    // --- opening it analyzes it on demand, then opens the review ---
    await card.click();
    await expect(page.locator("#review-panel")).toBeVisible({ timeout: 100_000 });
    await expect(page.locator("#picker-status")).toHaveText("");

    // --- the reason for the worst move names the piece ---
    await page.locator("#review-worst").click();
    await expect(page.locator("#review-caption")).toContainText("Blunder");
    await expect(page.locator("#review-why")).toBeVisible();
    await expect(page.locator("#review-why")).toContainText("queen on e5");

    // --- before view: the ranked candidates are shaded and listed ---
    await page.locator("#review-before").check();
    await expect(page.locator("#review-caption")).toContainText("Position before");
    await expect(page.locator("#review-candidates .candidate-chip").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.locator("#review-candidates .candidate-chip").count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator("#play-board-wrap .play-candidate-tint").count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator("#play-board-wrap .play-arrow-layer line").count()).toBeGreaterThanOrEqual(2); // best + played
    await page.screenshot({ path: "test-results/review-before-view.png", fullPage: false });

    // tapping a candidate previews it as another arrow
    const arrowsBefore = await page.locator("#play-board-wrap .play-arrow-layer line").count();
    await page.locator("#review-candidates .candidate-chip").nth(2).click();
    expect(await page.locator("#play-board-wrap .play-arrow-layer line").count()).toBeGreaterThanOrEqual(arrowsBefore);

    // --- try the position: a wrong move, then a strong one ---
    const strongUci = await page.locator("#review-candidates .candidate-chip").first().getAttribute("data-candidate");
    await page.locator("#review-try").click();
    await expect(page.locator("#try-panel")).toBeVisible();
    await expect(page.locator("#try-status")).toContainText("Your turn");
    await playMove(page, "a2", "a3");
    await expect(page.locator("#try-status")).toContainText("Not quite");
    await expect(page.locator("#try-show")).toBeVisible();
    await page.locator("#try-again").click();
    await playMove(page, strongUci!.slice(0, 2), strongUci!.slice(2, 4));
    await expect(page.locator("#try-status")).toContainText("✅");

    // --- leaving the try goes back to the review ---
    await page.locator("#try-done").click();
    await expect(page.locator("#try-panel")).toBeHidden();
    await expect(page.locator("#review-caption")).toContainText("Position before");

    // --- save it, and it shows up under Saved positions ---
    await page.locator("#review-save").click();
    await expect(page.locator("#saved-positions .saved-row")).toHaveCount(1);
    await expect(page.locator("#review-save")).toHaveText("Saved ✓");

    // --- and it survives a reload, practiceable with no game open ---
    await page.reload();
    await expect(page.locator("#saved-positions .saved-row")).toHaveCount(1);
    await page.locator("[data-saved-try]").first().click();
    await expect(page.locator("#try-panel")).toBeVisible();
    await expect(page.locator("#review-panel")).toBeHidden();
    await playMove(page, "a2", "a3");
    await expect(page.locator("#try-status")).toContainText(/Not quite|✅/);
    await page.locator("#try-done").click();
    await expect(page.locator("#try-panel")).toBeHidden();

    // --- remove it ---
    await page.locator("[data-saved-remove]").first().click();
    await expect(page.locator("#saved-positions .saved-row")).toHaveCount(0);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("a review does not lose a bot game in progress", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

    await seedAndLoad(page);

    // Start a bot game and make a move; the bot answers.
    await page.locator("#bot-new-game-btn").click();
    await expect(page.locator("#play-status")).toContainText("Your move", { timeout: 15_000 });
    await playMove(page, "e2", "e4");
    await expect(page.locator("#play-move-list")).toContainText("e4");
    await expect(page.locator("#play-status")).toContainText("Your move", { timeout: 30_000 }); // the bot has replied

    // Opening a synced game takes over the board and offers the game back.
    await page.locator("#picker-section .picker-card").click();
    await expect(page.locator("#review-panel")).toBeVisible({ timeout: 100_000 });
    await expect(page.locator("#resume-banner")).toBeVisible();

    await page.locator("#resume-btn").click();
    await expect(page.locator("#review-panel")).toBeHidden();
    await expect(page.locator("#play-move-list")).toContainText("e4");
    await expect(page.locator("#resume-banner")).toBeHidden();

    expect(problems, problems.join("\n")).toEqual([]);
  });
});
