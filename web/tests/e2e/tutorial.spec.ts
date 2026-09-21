import { test, expect, type Page } from "@playwright/test";

// The first-run tutorial, end to end, on the real WASM engine. Chess.com and
// Lichess are stubbed, so nothing depends on the network.
//
// The seeded game is White (the visitor) hanging the queen on move 7
// (7.Qxe5+?? Nxe5), after some knight shuffling that puts it past the
// opening moves the tutorial skips. Text effects are turned off so the guide's
// lines appear at once and "Next" always advances.

const BLUNDER_PGN =
  "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. e4 e5 6. Qh5 Nc6 7. Qxe5+ Nxe5 8. d4 Nc6 0-1";
const QUIET_PGN = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 0-1"; // nothing to teach from

function chessComMonth(pgn: string) {
  return {
    games: [
      {
        uuid: "tut-game-1",
        url: "https://www.chess.com/game/live/1",
        pgn,
        time_control: "600",
        time_class: "rapid",
        rules: "chess",
        rated: true,
        end_time: 1_780_000_000,
        eco: "https://www.chess.com/openings/Kings-Pawn-Game",
        white: { username: "tester", rating: 1200, result: "resigned" },
        black: { username: "rival", rating: 1250, result: "win" },
      },
    ],
  };
}

async function stubChessCom(page: Page, pgn: string) {
  await page.route("https://api.chess.com/**", (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.includes("/nobody/")) return json({ code: 0, message: "not found" }, 404);
    if (url.endsWith("/games/archives")) return json({ archives: ["https://api.chess.com/pub/player/tester/games/2026/09"] });
    return json(chessComMonth(pgn));
  });
}

async function stubLichess(page: Page, pgn: string) {
  await page.route("https://lichess.org/api/games/user/**", (route) => {
    const game = {
      id: "tutlich1",
      rated: true,
      variant: "standard",
      speed: "rapid",
      createdAt: 1_780_000_000_000,
      lastMoveAt: 1_780_000_300_000,
      status: "resign",
      players: {
        white: { user: { name: "tester", id: "tester" }, rating: 1200 },
        black: { user: { name: "rival", id: "rival" }, rating: 1250 },
      },
      winner: "black",
      opening: { eco: "C20", name: "King's Pawn Game" },
      pgn: `[White "tester"]\n[Black "rival"]\n[TimeControl "600+0"]\n\n${pgn}`,
    };
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: JSON.stringify(game) + "\n" });
  });
}

/** A fresh visitor who prefers the guide's text to appear at once. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("chegga-web:effects-enabled", "0");
    } catch {
      // ignore
    }
  });
});

const title = (page: Page) => page.locator("#tutorial-title");
const next = (page: Page) => page.locator("#tutorial-next");

async function clickSquares(page: Page, from: string, to: string) {
  await page.locator(`#tutorial-board [data-square="${from}"]`).click();
  await page.locator(`#tutorial-board [data-square="${to}"]`).click();
}

/** Plays the lesson from the first beat to the landing page, starting from the
 * "A move worth a second look" beat. */
async function playLesson(page: Page, opts: { expectSite?: string } = {}) {
  await expect(title(page)).toHaveText("A move worth a second look", { timeout: 90_000 });
  await next(page).click();

  await expect(title(page)).toHaveText("The position");
  await expect(page.locator("#tutorial-say")).toContainText("You are playing White");
  await expect(page.locator("#tutorial-board .play-candidate-tint")).toHaveCount(0); // the heatmap is not on yet
  await expect(page.locator("#tutorial-legend")).toBeHidden(); // and neither is its legend
  await next(page).click();

  await expect(title(page)).toHaveText("The heatmap");
  await expect(page.locator("#tutorial-legend")).toBeVisible();
  expect(await page.locator("#tutorial-board .play-candidate-tint").count()).toBeGreaterThanOrEqual(1);
  await next(page).click();

  await expect(title(page)).toHaveText(/^Why .+ is best$/);
  expect(await page.locator("#tutorial-board .play-arrow-layer line").count()).toBeGreaterThanOrEqual(1);
  await next(page).click();

  // Your turn: the guide names the move as squares, so read them.
  await expect(title(page)).toHaveText("Your turn");
  await expect(next(page)).toHaveCount(0);
  const ask = (await page.locator("#tutorial-say").innerText()).match(/on ([a-h][1-8]) to ([a-h][1-8])/)!;
  const [from, to] = [ask[1], ask[2]];

  // A legal move that is not the one asked for gets a nudge and is taken back.
  await clickSquares(page, "a2", "a3");
  await expect(page.locator("#tutorial-say")).toContainText("not the one I am asking for");
  await expect(page.locator(`#tutorial-board [data-square="a3"] img, #tutorial-board [data-square="a3"] .play-piece`)).toHaveCount(0);

  await clickSquares(page, from, to);
  await expect(title(page)).toHaveText("That is the move");
  await next(page).click();

  await expect(title(page)).toHaveText("What Chegga does");
  await expect(page.locator("#tutorial-say")).toContainText("any game you have played, at any move");
  if (opts.expectSite) await expect(page.locator("#tutorial-say")).toContainText(opts.expectSite);
  await next(page).click();

  await expect(page.locator("#tutorial")).toHaveCount(0);
}

test.describe("first-run tutorial", () => {
  test.setTimeout(180_000);

  test("Chess.com: reads the latest game, finds the miss, plays it, lands on the normal page", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await stubChessCom(page, BLUNDER_PGN);
    await page.goto("/");

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(title(page)).toHaveText("Welcome to Chegga");
    await expect(page.locator("#tutorial-form")).toContainText("never asks for a password");
    await page.locator("#tutorial-username").fill("tester");
    await page.getByRole("button", { name: "Look at my latest game" }).click();

    await playLesson(page, { expectSite: "Chess.com" });

    // The normal page, with their games in it.
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("#username")).toHaveValue("tester");
    await expect(page.locator("#picker-section .picker-card")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator("#saved-positions .saved-row")).toHaveCount(1); // the tutorial's position was kept
    expect(await page.evaluate(() => localStorage.getItem("chegga-web:tutorial"))).toBe("done");
    expect(await page.evaluate(() => localStorage.getItem("chegga-web:last-username"))).toBe("tester");
    expect(problems, problems.join("\n")).toEqual([]);

    // And it does not come back.
    await page.reload();
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("#tutorial")).toHaveCount(0);
  });

  test("Lichess: same lesson from a Lichess username", async ({ page }) => {
    await stubLichess(page, BLUNDER_PGN);
    await page.goto("/");
    await page.locator("#tutorial-form .tutorial-site", { hasText: "Lichess" }).click();
    await page.locator("#tutorial-username").fill("tester");
    await page.getByRole("button", { name: "Look at my latest game" }).click();

    await playLesson(page, { expectSite: "Lichess" });

    await expect(page.locator("#sync-site")).toHaveValue("lichess");
    await expect(page.locator("#username")).toHaveValue("tester");
    await expect(page.locator("#picker-section .picker-card")).toHaveCount(1, { timeout: 15_000 });
    expect(await page.evaluate(() => localStorage.getItem("chegga-web:last-site"))).toBe("lichess");
  });

  test("an unknown username says so and stays on the welcome step", async ({ page }) => {
    await stubChessCom(page, BLUNDER_PGN);
    await page.goto("/");
    await page.locator("#tutorial-username").fill("nobody");
    await page.getByRole("button", { name: "Look at my latest game" }).click();
    await expect(page.locator("#tutorial-error")).toContainText('no account named "nobody"', { timeout: 30_000 });
    await expect(title(page)).toHaveText("Welcome to Chegga");
  });

  test("a username with a space is refused before any request", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tutorial-username").fill("two words");
    await page.getByRole("button", { name: "Look at my latest game" }).click();
    await expect(page.locator("#tutorial-error")).toContainText("letters, numbers");
  });

  test("games with nothing to teach from fall back to the example, and say why", async ({ page }) => {
    await stubChessCom(page, QUIET_PGN);
    await page.goto("/");
    await page.locator("#tutorial-username").fill("tester");
    await page.getByRole("button", { name: "Look at my latest game" }).click();
    await expect(title(page)).toHaveText("A move worth a second look", { timeout: 90_000 });
    await expect(page.locator("#tutorial-say")).toContainText("did not find a clear missed move");
    await expect(page.locator("#tutorial-say")).toContainText("example game");
  });

  test("no account: the example plays through and ends on the normal page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "No account? Try an example game instead" }).click();
    await playLesson(page);
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("#username")).toHaveValue("");
    expect(await page.evaluate(() => localStorage.getItem("chegga-web:tutorial"))).toBe("done");
  });

  test("the username field is on screen without scrolling, on any screen", async ({ page }) => {
    await page.goto("/");
    await expect(title(page)).toHaveText("Welcome to Chegga");
    await expect(page.locator("#tutorial-username")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Look at my latest game" })).toBeInViewport();
  });

  test("the guide types its text, and a click finishes it before moving on", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("chegga-web:effects-enabled", "1"); // typing is an effect; this visitor has it on
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "No account? Try an example game instead" }).click();
    await expect(title(page)).toHaveText("A move worth a second look", { timeout: 60_000 });
    const lastLine = "Let's look at the position first. I won't show the better move yet.";
    await expect(page.locator("#tutorial-say")).not.toContainText(lastLine); // still being typed
    await next(page).click(); // the first click shows the rest of the text
    await expect(page.locator("#tutorial-say")).toContainText(lastLine);
    await expect(title(page)).toHaveText("A move worth a second look");
    await next(page).click(); // the second one moves on
    await expect(title(page)).toHaveText("The position");
  });

  test("skipping closes it at once and it is not shown again", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Skip tutorial" }).click();
    await expect(page.locator("#tutorial")).toHaveCount(0);
    await expect(page.locator("#main-content")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("chegga-web:tutorial"))).toBe("skipped");
    await page.reload();
    await expect(page.locator("#tutorial")).toHaveCount(0);
  });

  test("Escape skips it too", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#tutorial")).toHaveCount(0);
  });

  test("the page behind the dialog cannot be reached while it is open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.locator("#app").getAttribute("inert")).not.toBeNull();
    await page.getByRole("button", { name: "Skip tutorial" }).click();
    expect(await page.locator("#app").getAttribute("inert")).toBeNull();
  });

  test("a returning visitor does not see it, and ?tutorial=1 brings it back", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("chegga-web:last-username", "someone");
      } catch {
        // ignore
      }
    });
    await page.route("https://api.chess.com/**", (route) => route.fulfill({ status: 404, body: "{}" }));
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("#tutorial")).toHaveCount(0);
    await page.goto("/?tutorial=1");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("the footer link replays it", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("chegga-web:tutorial", "done");
      } catch {
        // ignore
      }
    });
    await page.goto("/");
    await page.locator("#replay-tutorial").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
