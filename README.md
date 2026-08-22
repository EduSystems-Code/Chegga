# Chegga

A personal Chess.com game analyzer: pulls your own game history via Chess.com's
official read-only API, runs it through Stockfish, and (in later phases) builds a
strength estimator, a mistake-drill trainer, Claude-generated coaching, and a
tracking dashboard on top of that.

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
2. Run the engine analysis pipeline:
   ```powershell
   cd backend
   .venv\Scripts\Activate.ps1
   python -m app.scripts.run_analysis --limit 20
   ```
   Analyzes your **newest** unanalyzed games first (so you get useful data quickly)
   — run it again with a higher `--limit`, or without `--limit`, to work through
   your full history in the background. This can take a while for a large history;
   see the note on analysis cost below.
3. Refresh the games list — analyzed games show a checkmark and link to a move-by-
   move eval graph.

## Known limitations (Phase 0–2.5 scope)

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

## Roadmap (not yet built)

- **Strength estimator** — a model estimating your real playing strength from move
  quality, tracked over time.
- **Drill generator** — mines your own recurring mistakes into replayable puzzles.
- **Claude coaching** — narrates your aggregate stats in prose (never asked to
  itself judge a position — that's Stockfish's job).
- **Tracking dashboard** — rating, strength-estimate, and accuracy trends over time.

See `docs/` (once it exists) or ask for the full phased plan this was built from.
