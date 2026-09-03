import { defineConfig } from "vitest/config";

// Unit tests for the pure analysis functions only — the code paths that
// turn synced games + move analysis into the numbers every card shows.
// No DOM, no engine, no network: `environment: "node"` keeps it fast and
// makes a missing `localStorage`/`window` a caught fallback, not a crash
// (see classificationColors.ts).
//
// The end-to-end deploy smoke test lives in tests/e2e/ and runs under
// Playwright (`npm run test:smoke`), not here.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
