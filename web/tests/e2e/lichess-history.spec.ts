import { test, expect, type Page } from "@playwright/test";

// The Lichess "Get my full history" control (siteSync full-history sync),
// stubbed end to end. Mirrors the Chess.com control's shape and wording; see
// lichessHistory.test.ts for the paging/resume/429 logic itself.

const USERNAME = "teststudent";
const PAGE_SIZE = 200; // must match LICHESS_HISTORY_PAGE_SIZE in lichessHistory.ts
const TOTAL_GAMES = 650; // several full pages, so a run takes real time to cancel mid-way

function fakeGame(i: number) {
  const createdAt = Date.UTC(2026, 0, 1) - i * 60_000; // newest first, one minute apart
  return {
    id: `h${String(i).padStart(4, "0")}`,
    rated: true,
    variant: "standard",
    speed: "blitz",
    createdAt,
    lastMoveAt: createdAt + 60_000,
    status: "resign",
    players: {
      white: { user: { name: USERNAME, id: USERNAME }, rating: 1500 },
      black: { user: { name: "rival", id: "rival" }, rating: 1500 },
    },
    winner: "white",
    opening: { eco: "C20", name: "King's Pawn Game" },
    pgn: `[White "${USERNAME}"]\n[Black "rival"]\n[TimeControl "180+0"]\n\n1. e4 e5 1-0`,
  };
}

/** Serves `total` games, newest first, honouring `max` and `until` exactly
 * like the real endpoint -- so the client's own paging drives how many
 * requests happen, same as against Lichess for real. */
async function stubLichessHistory(page: Page, total: number) {
  const games = Array.from({ length: total }, (_, i) => fakeGame(i));
  await page.route("https://lichess.org/api/games/user/**", async (route) => {
    const url = new URL(route.request().url());
    const until = url.searchParams.has("until") ? Number(url.searchParams.get("until")) : Infinity;
    const max = Number(url.searchParams.get("max"));
    const games_ = games.filter((g) => g.createdAt <= until).slice(0, max);
    const body = games_.map((g) => JSON.stringify(g)).join("\n") + (games_.length ? "\n" : "");
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
}

test.describe("Lichess full history", () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    // Skip the first-run tutorial; this is about the "Get started" form itself.
    await page.addInitScript(() => {
      try {
        localStorage.setItem("chegga-web:tutorial", "done");
      } catch {
        // ignore
      }
    });
  });

  test("appears only for Lichess, grows as it runs, cancels, and resumes to completion", async ({ page }) => {
    await stubLichessHistory(page, TOTAL_GAMES);
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();

    const control = page.locator("#lichess-history");
    const runBtn = page.locator("#lichess-history-btn");
    const cancelBtn = page.locator("#lichess-history-cancel");
    const syncLog = page.locator("#sync-log");

    // Chess.com is the default picker; the Lichess control is not shown.
    await expect(control).toBeHidden();

    await page.locator("#sync-site").selectOption("lichess");
    await expect(control).toBeVisible();
    await runBtn.scrollIntoViewIfNeeded();
    await expect(runBtn).toBeInViewport();

    await page.locator("#username").fill(USERNAME);
    // force: the sticky section nav overlaps this control, same as it does
    // over the Chess.com controls -- not something this change should fix.
    await runBtn.click({ force: true });

    // Count grows as games are stored -- real IndexedDB writes give real
    // yields between games, so more than one value is observable.
    await expect(syncLog).toContainText(/\d+ new games so far/, { timeout: 10_000 });
    const midText = await syncLog.innerText();
    const midCount = Number(/(\d+) new games so far/.exec(midText)![1]);
    expect(midCount).toBeGreaterThan(0);

    await cancelBtn.click({ force: true });
    await expect(syncLog).toContainText(/^Stopped: \d+ new games synced so far/, { timeout: 10_000 });
    const stoppedText = await syncLog.innerText();
    const stoppedCount = Number(/Stopped: (\d+) new games synced so far/.exec(stoppedText)![1]);
    expect(stoppedCount).toBeGreaterThan(0);
    expect(stoppedCount).toBeLessThan(TOTAL_GAMES);

    // The control is back to its idle state -- nothing left running.
    await expect(runBtn).toBeVisible();
    await expect(cancelBtn).toBeHidden();

    // Run it again: it resumes below what is already stored, not from zero.
    await runBtn.click({ force: true });
    await expect(syncLog).toContainText(/new games synced\. Full history is up to date\./, { timeout: 45_000 });
    const finalText = await syncLog.innerText();
    const finalCount = Number(/^(\d+) new games synced\. Full history is up to date\./.exec(finalText)![1]);

    expect(stoppedCount + finalCount).toBe(TOTAL_GAMES);
    // Full history stores only -- it never starts analysis.
    expect(finalText).not.toContain("Analyzing");

    // Switching back to Chess.com hides the control again.
    await page.locator("#sync-site").selectOption("chesscom");
    await expect(control).toBeHidden();
  });

  test("an empty account finishes at once with a plain message", async ({ page }) => {
    await stubLichessHistory(page, 0);
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();

    await page.locator("#sync-site").selectOption("lichess");
    await page.locator("#username").fill(USERNAME);
    await page.locator("#lichess-history-btn").click();

    await expect(page.locator("#sync-log")).toContainText(`Lichess has no games for "${USERNAME}" yet.`, { timeout: 10_000 });
  });

  test("a 404 username says so, matching the Chess.com control's wording style", async ({ page }) => {
    await page.route("https://lichess.org/api/games/user/**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Not found"}' }),
    );
    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();

    await page.locator("#sync-site").selectOption("lichess");
    await page.locator("#username").fill("nobody_here");
    await page.locator("#lichess-history-btn").click();

    await expect(page.locator("#sync-log")).toContainText('no account named "nobody_here"', { timeout: 10_000 });
    // The control is usable again, not stuck disabled.
    await expect(page.locator("#lichess-history-btn")).toBeVisible();
  });
});
