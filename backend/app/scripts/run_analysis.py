"""CLI entry point for batch-analyzing pending games with Stockfish.

    python -m app.scripts.run_analysis --limit 20

Prints progress so the real cost (games/sec, elapsed time) is visible before
committing to a full multi-year backlog -- see the Risks section in the plan
this was built from for why that number can be large.
"""
import argparse
import logging
import time

from app.config import get_settings
from app.db.session import SessionLocal
from app.services.engine_analysis import analyze_pending_games

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze pending games with Stockfish")
    parser.add_argument("--limit", type=int, default=None, help="Max games to analyze this run")
    args = parser.parse_args()

    settings = get_settings()
    db = SessionLocal()
    start = time.monotonic()
    try:
        count = analyze_pending_games(db, settings, limit=args.limit)
    finally:
        db.close()
    elapsed = time.monotonic() - start
    print(f"Analyzed {count} games in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
