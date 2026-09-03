import { defineConfig, devices } from "@playwright/test";

// Deploy smoke test (critique #2). Two ways to run it:
//   npm run test:smoke                         -> builds this branch, serves
//                                                 it on :5174, tests that
//   SMOKE_URL=https://chegga-web.vercel.app npm run test:smoke
//                                              -> tests the live deploy
//
// One-time setup before the first run: `npx playwright install chromium`
// (downloads the browser; not committed, not in node_modules).
const SMOKE_URL = process.env.SMOKE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: SMOKE_URL ?? "http://localhost:5174",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: SMOKE_URL
    ? undefined
    : {
        command: "npm run build && npm run preview",
        url: "http://localhost:5174",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
