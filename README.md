# Chegga

A personal Chess.com game analyzer: pulls your own game history via Chess.com's
official read-only API, runs it through Stockfish, and builds a strength
estimator, a mistake-drill trainer, Claude-generated coaching, and a player
profile/tracking dashboard on top of that.

This is a personal-use tool for a single Chess.com account, not a public product.

## TOS

Uses only Chess.com's official [Published-Data API](https://www.chess.com/announcements/view/published-data-api)
(`api.chess.com/pub/...`) — never the HTML site, which their Terms of Service
explicitly bans scraping. Requests are serial by construction (see
`app/services/chess_com_client.py`); Chess.com's own guidance is that serial access
is unlimited but bursts of parallel requests can trigger rate limiting.

## Stack

- **Backend**: FastAPI + SQLAlchemy + Alembic + `python-chess` (driving a local
  Stockfish binary) + SQLite.
- **Frontend**: Vite + React + TypeScript + Recharts.

## Setup

### Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then fill in CHESS_COM_USERNAME, CHESS_COM_CONTACT, STOCKFISH_PATH
# ANTHROPIC_API_KEY is optional -- only the coaching feature needs it; everything
# else (sync, analysis, profile, strength model, drills) works without one.
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

`GET http://localhost:8000/api/health` should return `{"status": "ok"}`.

Stockfish itself is never committed (it's a platform-specific binary) — download a
build from [stockfishchess.org](https://stockfishchess.org/download/) and point
`STOCKFISH_PATH` in `.env` at it.

### Frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Using it

1. Click **Sync from Chess.com** on the games list page — pulls your full game
   history incrementally (safe to click again any time; already-synced months are
   skipped).
2. Click **Analyze next 50 with Stockfish** on the same page, or for a full
   history run the CLI in the background instead (a browser click won't survive
   closing the tab; this will):
   ```powershell
   cd backend
   .venv\Scripts\Activate.ps1
   python -m app.scripts.run_analysis            # no --limit: works the whole backlog
   ```
   Either path analyzes your **newest** unanalyzed games first, so you get useful
   data quickly. Don't run the CLI backfill and click the button at the same
   time against a large backlog — both will pull from the same pending-games
   query and just contend with each other for no benefit. See the note on
   analysis cost below for how long a full history actually takes.
3. **Profile** page — aggregate stats, phase/opening breakdown, a monthly
   play-quality trend, and the strength model (below).
4. **Strength model** — click **Train / retrain** on the Profile page once you
   have at least 20 analyzed games. Predicts your Chess.com rating from a
   game's move quality alone and reports cross-validated MAE/R² so you can see
   how much to trust it; retrain any time as the analyzed count grows.
5. **Drills** page — multiple-choice "find the best move" practice pulled from
   your own real mistakes and blunders, weighted toward the costliest ones.
   Solving one excludes it going forward; missing one leaves it eligible.
6. **Coaching** (Profile page, bottom) — turns your aggregate profile and worst
   blunders into prose feedback via Claude. Needs `ANTHROPIC_API_KEY` set in
   `backend/.env`; without one, generation fails with a clear message instead
   of a stack trace, and everything else in the app is unaffected.

## Known limitations

- **Chess960/variant games**: ingested, but skipped by the analysis pipeline —
  standard chess (`rules: "chess"`) only for now.
- **Analysis cost**: at the default depth/movetime, expect roughly 3–4 board
  positions analyzed per second on typical hardware. A multi-year active-player
  history can be tens of thousands of plies — hours to over a day of engine time if
  run in one pass. `run_analysis.py` processes newest games first for exactly this
  reason; there's no need to wait for a full backfill before using the app.
- **Blunder/mistake/inaccuracy thresholds**: there's no industry standard for these
  labels. Chegga's own centipawn-loss cutoffs are in
  `app/services/engine_analysis.py` (`_CLASSIFICATION_THRESHOLDS`) and are meant to
  be tuned.
- **Strength model needs real volume to mean much**: it refuses to train below 20
  analyzed games, and its cross-validated MAE/R² (shown next to the Train button)
  is the honest measure of how much to trust a given prediction — early on, with
  few games and one time control, treat it as a rough signal, not a verdict.
- **Coaching reports are cached, not live**: generating a new one is a deliberate
  action, not something that happens automatically as more games get analyzed
  (see `app/services/coaching_service.py` for why).

## Architecture note

`app/services/*.py` is one file per concern (ingestion, engine analysis, player
profile aggregation, the strength model, drill selection, coaching) and each is
plain, independently testable Python -- `tests/` exercises all of them directly
against an in-memory DB rather than only through the API. The API layer
(`app/api/routes/*.py`) is a thin FastAPI wrapper: long-running work (sync,
analysis, training, coaching generation) all follow the same
`BackgroundTasks` + in-process status-dict + polling pattern, first established
by the sync endpoint.
