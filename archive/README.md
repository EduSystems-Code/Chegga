# archive/ — the pre-consolidation Chegga

On **2026-08-28** Chegga and "Chegga Web" were consolidated into one
project: the browser app in [`../web/`](../web/) is the app. This folder
holds what it replaced, kept for reference rather than deleted.

## What's here

- **`backend/`** — the original FastAPI + SQLAlchemy + Alembic + SQLite
  service that drove a local Stockfish binary. It did sync, engine
  analysis, the player profile, the strength model, drills, rival /
  matchup tracking, and a Claude-generated coaching report. Everything
  except coaching was ported to `web/` as client-side TypeScript
  (analysis logic carried over unchanged; the strength model was
  retrained offline and frozen into a JS constant). `backend/tests/`
  still runs (49 tests) if you recreate the venv — `python -m venv .venv
  && .venv\Scripts\pip install -r requirements.txt && .venv\Scripts\python
  -m pytest`.
  - `backend/data/chegga.db` (git-ignored, ~265 MB) is the local synced +
    Stockfish-analyzed history for the `MichaelBottega` account — hours of
    engine time. Kept because it's expensive to regenerate, not because
    anything still reads it.
- **`frontend/`** — the original Vite + React + TypeScript + Recharts UI
  that talked to `backend/`. Fully superseded by `web/`.

## Why it's archived, not deleted

The vault's housekeeping rule: things get archived, not deleted. The port
to `web/` is verified feature-for-feature (see
`my-brain/projects/chegga/consolidation-plan.md`), but the old code is the
reference if a ported behaviour is ever questioned.

**Coaching** is the one piece that was never ported — it stays parked
pending a real Anthropic cost decision. `backend/app/services/coaching_service.py`
+ `backend/app/api/routes/coaching.py` are where it lived.
