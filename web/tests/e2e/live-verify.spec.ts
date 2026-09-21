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


// Closes out the "owed" click-through from context.md for the
// 2026-08-28/29/30 pushes: Featurebase panel, Tally iframe, jump-nav
// offsets under the sticky header, and hero CTA behavior — run against
// the live deploy with SMOKE_URL=https://chegga-web.vercel.app.

test.describe("feedback widgets", () => {
  test("the header Feedback button is visible and opens the Featurebase panel", async ({
    page,
  }) => {
    await page.goto("/");
    const btn = page.locator("#feedback-btn");
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    // Featurebase opens its panel as a "Feedback" dialog containing an iframe.
    const dialog = page.getByRole("dialog", { name: "Feedback" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator("iframe")).toBeAttached();
  });

  test("opening the Send feedback card loads the Tally form", async ({ page }) => {
    await page.goto("/");
    const details = page.locator("#feedback-form-details");
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);
    const iframe = page.locator("#tally-embed iframe");
    await expect(iframe).toBeAttached({ timeout: 10_000 });
    // embed.js promotes data-tally-src -> src once the script loads
    await expect(async () => {
      const src = await iframe.getAttribute("src");
      expect(src).toContain("tally.so");
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("jump nav", () => {
  const targets = [
    ["#today-section", "Today"],
    ["#sync-section", "Get started"],
    ["#profile-section", "Profile"],
    ["#play-section", "Play"],
    ["#coming-soon-section", "Coming soon"],
    ["#feedback-form-details", "Feedback"],
  ] as const;

  for (const [id, label] of targets) {
    test(`"${label}" lands with its heading clear of the sticky nav`, async ({ page }) => {
      await page.goto("/");
      const nav = page.locator("nav.section-nav");

      await page.locator(`nav.section-nav a[href="${id}"]`).click();
      // native anchor jump is instant; give layout + the sticky-pin a tick to settle
      await page.waitForTimeout(300);

      // read the nav's position AFTER scrolling, once it's pinned by
      // position:sticky at the top of the viewport
      const navBox = await nav.boundingBox();
      expect(navBox).not.toBeNull();

      const target = page.locator(id);
      const targetBox = await target.boundingBox();
      expect(targetBox, `${id} should be visible after the jump`).not.toBeNull();
      // the target's top must be at/below the bottom of the sticky nav —
      // otherwise the heading is hidden underneath it
      expect(targetBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 2);
    });
  }
});

test.describe("hero CTAs", () => {
  test("Analyze my games scrolls to Get started and focuses the username field", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("#hero-analyze-btn").click();
    await expect(page.locator("#username")).toBeFocused({ timeout: 2_000 });
    await expect(page.locator("#sync-section")).toBeInViewport();
  });

  test("Play a bot instead scrolls to and expands the Play card", async ({ page }) => {
    await page.goto("/");
    await page.locator("#hero-play-btn").click();
    await expect(page.locator("#play-section")).toBeInViewport();
  });
});

test.describe("coming soon", () => {
  test("the Coming soon card lists all 15 parked features and a jump link opens one", async ({
    page,
  }) => {
    await page.goto("/");
    const card = page.locator("#coming-soon-section");
    await expect(card).toBeAttached();
    const parked = page.locator("[data-coming-soon='true']");
    await expect(parked).toHaveCount(15);
    for (const el of await parked.all()) {
      await expect(el).toBeHidden();
    }
  });
});

test.describe("keyboard tabbing", () => {
  test("tabbing from the top of the page does not throw and reaches the sync form", async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.goto("/");
    await page.keyboard.press("Tab");
    let reachedUsername = false;
    for (let i = 0; i < 40 && !reachedUsername; i++) {
      const id = await page.evaluate(() => document.activeElement?.id || "");
      if (id === "username") reachedUsername = true;
      else await page.keyboard.press("Tab");
    }
    expect(reachedUsername, "Tab order never reached #username within 40 stops").toBe(true);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
