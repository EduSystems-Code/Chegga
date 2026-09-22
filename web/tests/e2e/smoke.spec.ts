import { test, expect } from "@playwright/test";

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


// The pre-connect surface — everything a first-time visitor sees before
// they type a username. This is what actually ships to a phone from a
// shared link, so it is the highest-value thing to keep un-broken.
//
// Walking the growth cards against a real analysed account is the
// "bundled demo dataset" describe block at the bottom of this file.

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

  // The app says a visitor's games stay in their browser, so nothing from
  // the feedback vendors may load until the visitor asks for feedback.
  test("Featurebase loads only after the Feedback button is clicked", async ({ page }) => {
    const featurebaseRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("featurebase")) featurebaseRequests.push(req.url());
    });

    await page.goto("/");
    await expect(page.locator("#feedback-btn")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(featurebaseRequests, featurebaseRequests.join("\n")).toEqual([]);
    await expect(page.locator("#featurebase-sdk")).toHaveCount(0);

    await page.locator("#feedback-btn").click();
    await expect(page.locator("#featurebase-sdk")).toHaveCount(1);
    await expect.poll(() => featurebaseRequests.length).toBeGreaterThan(0);
  });

  test("a blocked Featurebase script sends the click to the public feedback page", async ({
    page,
  }) => {
    await page.route("**/do.featurebase.app/**", (route) => route.abort());
    await page.goto("/");

    const popup = page.waitForEvent("popup");
    await page.locator("#feedback-btn").click();
    const feedbackPage = await popup;
    await expect.poll(() => feedbackPage.url()).toContain("mibottega.featurebase.app");
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

// The growth cards had never been click-tested against real data — there was
// no way to get data into the page without a real account and an engine run.
// The bundled demo dataset is that way, so this is the run they never got.
//
// The five cards sit behind the "Coming soon" gate (`data-coming-soon`), which
// CSS-hides them regardless of their own state. So these assert what the data
// actually drives: the card un-hid itself (each one sets display:none when its
// compute function returns nothing) and its output holds real content.
const GROWTH_CARDS = [
  { section: "#road-section", output: "#road-output", expect: /Model estimate now/i },
  { section: "#weekly-plan-section", output: "#weekly-plan-output", expect: /Mon|Tue|Wed/i },
  { section: "#blunder-rate-section", output: "#blunder-rate-output", expect: /per 100/i },
  { section: "#consistency-section", output: "#consistency-output", expect: /after a loss/i },
  { section: "#convert-section", output: "#convert-output", expect: /\+\d/ },
];

test.describe("bundled demo dataset", () => {
  test("every growth card renders real content, with no errors", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
    });

    await page.goto("/");
    await page.locator("#demo-load-btn").click();

    await expect(page.locator("#demo-banner")).toBeVisible();
    await expect(page.locator("#sync-log")).toContainText(/sample games/i);

    for (const card of GROWTH_CARDS) {
      const section = page.locator(card.section);
      await expect(section).toBeAttached();
      // Hidden by the Coming-soon gate, but its own data-driven toggle must
      // have opened it — "none" here means the card found nothing to show.
      await expect
        .poll(async () => section.evaluate((el: HTMLElement) => el.style.display), {
          message: `${card.section} stayed hidden — its compute function returned nothing`,
        })
        .not.toBe("none");

      const output = page.locator(card.output);
      await expect(output).toContainText(card.expect);
      const text = ((await output.textContent()) ?? "").trim();
      expect(text.length, `${card.output} rendered almost nothing`).toBeGreaterThan(80);
      expect(text).not.toMatch(/not enough data|no data yet/i);
    }

    // The cards that are on the front page should have filled in too.
    await expect(page.locator("#profile-output")).toContainText(/\d/);
    await expect(page.locator("#picker-output")).toContainText(/\d/);

    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("clearing the demo returns the page to its empty state", async ({ page }) => {
    await page.goto("/");
    await page.locator("#demo-load-btn").click();
    await expect(page.locator("#demo-banner")).toBeVisible();

    await page.locator("#demo-clear-btn").click();

    // The clear reloads the page; the banner must not come back.
    await expect(page.locator("#demo-banner")).toBeHidden();
    await expect(page.locator("#picker-section .empty-state")).toBeVisible();
    await expect(page.locator("#road-section")).toHaveJSProperty("style.display", "none");
  });

  test("the demo survives a reload without trying to sync a fake account", async ({ page }) => {
    const siteRequests: string[] = [];
    await page.goto("/");
    await page.locator("#demo-load-btn").click();
    await expect(page.locator("#demo-banner")).toBeVisible();

    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("chess.com") || url.includes("lichess.org")) siteRequests.push(url);
    });

    await page.reload();
    await expect(page.locator("#demo-banner")).toBeVisible();
    await expect(page.locator("#profile-output")).toContainText(/\d/);
    expect(siteRequests, siteRequests.join("\n")).toEqual([]);
  });
});
