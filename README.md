# Chegga

A browser-based Chess.com game analyzer and trainer. Connect your
Chess.com username and Chegga pulls your whole game history, analyzes it
with Stockfish, and shows you the patterns a human can't see across
thousands of games — move-quality trend, opening repertoire, blunder
tendencies, time-pressure correlation, a strength estimate, rival /
matchup records — plus training tools built on the same data.

**Everything runs client-side.** Stockfish is compiled to WebAssembly and
runs in a Web Worker in your own tab; your games and analysis live in your
browser's IndexedDB. There is no backend and no server-side compute.

Live: **https://chegga-web.vercel.app** (auto-deploys from `main`).

## The one app is `web/`

```powershell
cd web
npm install
npm run dev          # external browser
npm run dev:vscode   # static build for VS Code's Simple Browser (no HMR)
```

`web/` is a plain Vite + TypeScript app — no framework runtime. It builds
to `web/dist/`; `vercel.json` at the repo root pins the Vercel build to
`web/`.

## History: `archive/`

Chegga started as a local personal tool: a FastAPI + SQLAlchemy backend
driving a native Stockfish binary, with a React frontend. That version and
its browser rewrite ("Chegga Web") were **consolidated into this one
browser app on 2026-08-28**. The old `backend/` and `frontend/` now live
under [`archive/`](archive/) — see `archive/README.md`. The analysis
logic carried over unchanged; the one piece not ported is the
Claude-generated coaching report, which stays parked.

## Using it

1. **Connect** your Chess.com username — pulls your full history
   incrementally (safe to re-run; already-synced months are skipped).
2. **Analyze** — Stockfish works your newest games first, so useful data
   shows up quickly. Analysis is real engine time in your browser; a big
   history is a long run.
3. **Your focus** / **Your profile** — a rule-based skill assessment,
   aggregate stats, phase/opening breakdown, a play-quality trend, and a
   rough strength estimate (honest about its small-sample cross-validation
   score).
4. **Puzzles** — your own blunders as replay puzzles, plus a bundled
   ~99k-puzzle CC0 Lichess tactics library with a personal puzzle rating,
   a daily "Today" set, a redemption list, and achievements.
5. **Play vs. bot**, board themes, piece sets, a PK-mastery taxonomy
   browser, rival tracking.

## Notes

- **API only, never scraping.** Uses Chess.com's official read-only
  [Published-Data API](https://www.chess.com/announcements/view/published-data-api);
  requests are serial.
- **Engine drift.** The lite WASM Stockfish build (~7 MB) is smaller and
  weaker than full native Stockfish (~113 MB), so centipawn-loss values
  and move classifications can differ slightly from other analyzers. This
  is a deliberate "just visit a URL" tradeoff, documented in the UI.
- **Blunder/mistake/inaccuracy thresholds** are Chegga's own tunable
  convention, not an industry standard.
- **Chess960 / variants** are skipped by analysis — standard chess only.
- Chess piece sets (Cburnett, Merida) are bundled under `web/public/piece/`
  under GPLv2+ with attribution in the app footer.
