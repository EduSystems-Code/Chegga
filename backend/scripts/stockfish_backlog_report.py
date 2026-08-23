"""
Stockfish backlog report — a status check, not an analysis run.

Reads the local SQLite DB directly (read-only) and prints how many games
are analyzed vs. total, plus a rate-based ETA for the remainder. No model
call, no Stockfish invocation — this is a script, not a skill, because
there's no judgment involved, just counting.

Usage:
    python scripts/stockfish_backlog_report.py
    python scripts/stockfish_backlog_report.py --rate 40   # override games/hr estimate

Run from backend/ (needs data/chegga.db to exist).
"""

import argparse
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "chegga.db"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rate",
        type=float,
        default=None,
        help="Override games/hour estimate (default: derived from analyzed_at timestamps)",
    )
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f"No database found at {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    cur = conn.cursor()

    total = cur.execute("SELECT COUNT(*) FROM games").fetchone()[0]
    analyzed = cur.execute("SELECT COUNT(*) FROM games WHERE analyzed = 1").fetchone()[0]
    remaining = total - analyzed

    print(f"Analyzed: {analyzed:,} / {total:,}  ({remaining:,} remaining)")
    if total:
        print(f"Progress: {analyzed / total * 100:.1f}%")

    rate = args.rate
    if rate is None:
        # Derive games/hour from the most recent analyzed_at timestamps,
        # falling back gracefully if there's not enough history yet.
        rows = cur.execute(
            "SELECT analyzed_at FROM games WHERE analyzed_at IS NOT NULL "
            "ORDER BY analyzed_at DESC LIMIT 200"
        ).fetchall()
        timestamps = [datetime.fromisoformat(r[0]) for r in rows if r[0]]
        if len(timestamps) >= 2:
            span = (timestamps[0] - timestamps[-1]).total_seconds() / 3600
            if span > 0:
                rate = (len(timestamps) - 1) / span

    if rate and rate > 0 and remaining > 0:
        eta_hours = remaining / rate
        eta = datetime.now() + timedelta(hours=eta_hours)
        print(f"Rate: ~{rate:.1f} games/hr")
        print(f"ETA: ~{eta_hours:.1f}h from now ({eta.strftime('%Y-%m-%d %H:%M')})")
    elif remaining > 0:
        print("Rate: not enough history yet to estimate an ETA.")
    else:
        print("Backlog complete.")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
