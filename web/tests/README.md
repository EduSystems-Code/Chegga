# web/ tests

The `web/` app had no test suite until 2026-09-03 — the `pre-push` hook
only ran the archived FastAPI backend's pytest and skipped `web/`
silently. This is the start of a real one.

## Unit tests — `tests/unit/`

Pure analysis functions: the code that turns synced games + move analysis
into the numbers every card shows. No DOM, no engine, no network.

```
npm test           # run once
npm run test:watch # watch mode
```

Covered so far: `clockParser`, `timePressure`, `blunderRate`,
`consistencyMetrics`, `classificationColors`, `rivalTracking` (the
since-last-visit delta).

Good next targets: `strengthEstimate`, `roadTo2000` (the frozen-model
inversion — critique #8), `blunderTagger`, `gameNormalizer`.

## Deploy smoke test — `tests/e2e/`

Playwright. Checks the pre-connect landing page (what a shared link opens
to on a phone): loads with no thrown / console errors, hero + CTAs
present, connect form keyboard-usable, data-export control present, no
horizontal scroll on a phone viewport. Runs on desktop + a Pixel 7
profile.

One-time setup:

```
npx playwright install chromium
```

Then:

```
npm run test:smoke                                   # builds this branch, serves :5174, tests it
SMOKE_URL=https://chegga-web.vercel.app npm run test:smoke   # tests the live deploy
```

The growth-card walk (critique #2 — force each card visible against a
real analysed account) is a `test.fixme` until the bundled demo dataset
(critique #1) exists.

## Not wired to a gate yet

`npm test` is green but nothing runs it automatically. Wiring it into the
`pre-push` hook (and a repointed `/deep_regression`) is deliberately left
for the human — it changes the local dev workflow.
