import { test, expect } from "@playwright/test";

// The pre-connect surface — everything a first-time visitor sees before
// they type a username. This is what actually ships to a phone from a
// shared link, so it is the highest-value thing to keep un-broken.
//
// Walking the growth cards (forcing each visible against a real analysed
// account, per critique #2) needs the bundled demo dataset from critique
// #1, which is still on hold — see the fixme at the bottom.

test.describe("landing page smoke", () => {
  test("loads with no thrown errors or console errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await expect(page.locator("#main-content")).toBeVisible();
    // let deferred init (DB open, feature-detects) settle
    await page.waitForTimeout(1500);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("shows the hero and both primary CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("section.hero")).toBeVisible();
    await expect(page.locator("#hero-analyze-btn")).toBeVisible();
    await expect(page.locator("#hero-play-btn")).toBeVisible();
  });

  test("the connect form is reachable and usable by keyboard", async ({ page }) => {
    await page.goto("/");
    const username = page.locator("#username");
    await username.focus();
    await expect(username).toBeFocused();
    await username.fill("MagnusCarlsen");
    await expect(page.locator("#sync-btn")).toBeVisible();
  });

  test("the data export control is present (no silent data-loss trap)", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#export-data-btn")).toBeAttached();
  });

  // The review itself needs an analyzed game (real engine time), so the
  // deploy check is that its controls shipped and start out of the way.
  test("the game review is wired up, and stays hidden until there is a game", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#review-panel");
    await expect(panel).toBeAttached();
    await expect(panel).toBeHidden();
    for (const id of [
      "#review-strip-host",
      "#review-caption",
      "#review-first",
      "#review-prev",
      "#review-next",
      "#review-last",
      "#review-autoplay",
      "#review-worst",
      "#review-why",
      "#review-before",
      "#review-candidates",
      "#review-try",
      "#review-save",
      "#review-save-key",
      "#try-panel",
    ]) {
      await expect(page.locator(id)).toBeAttached();
    }
    await expect(page.locator("#try-panel")).toBeHidden();
  });

  // The game picker needs synced games, so before a username is connected
  // it should show its designed waiting state with a way to get started,
  // not vanish or sit empty (the seeded-game run is review-picker.spec.ts).
  test("the game picker shows a waiting state before there are games", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("#picker-section");
    await expect(section).toBeVisible();
    await expect(section.locator(".empty-state")).toBeVisible();
    await expect(section.locator("[data-empty-cta]")).toBeVisible();
    await expect(page.locator('a[href="#picker-section"]')).toBeAttached(); // and it is in the jump nav
  });

  test("body does not scroll horizontally on a phone viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    // a few px of sub-pixel rounding is fine; a real overflow is not
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

// TODO(after critique #1 lands the bundled demo dataset): load the demo
// account, then for each growth card (#road-to-2000, #weekly-plan,
// #blunder-rate, #consistency, #convert-the-win) assert it renders,
// contains its expected numbers, and throws nothing; tab the whole page
// and snapshot the focus order.
test.fixme("growth cards render against the demo dataset", () => {});
