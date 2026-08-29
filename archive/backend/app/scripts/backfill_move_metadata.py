"""One-time backfill for blunder_tag and clock_seconds on MoveAnalysis rows
that were analyzed before those columns existed. Both are pure-Python /
PGN-only computations -- no Stockfish, no re-analysis -- so this is cheap
even across thousands of rows, unlike re-running engine_analysis itself.

    python -m app.scripts.backfill_move_metadata

New analysis (engine_analysis.analyze_game) already populates both columns
going forward; this script only exists for the gap between "already
analyzed" and "this feature shipped."
"""
import io
import logging

import chess.pgn
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.services.blunder_tagger import tag_move
from app.services.clock_parser import parse_clocks_by_ply
from app.services.time_pressure_service import band_for

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def backfill_blunder_tags(db) -> int:
    rows = list(
        db.scalars(
            select(MoveAnalysis).where(
                MoveAnalysis.classification.in_(("mistake", "blunder")), MoveAnalysis.blunder_tag.is_(None)
            )
        )
    )
    for move in rows:
        move.blunder_tag = tag_move(
            fen_before=move.fen_before,
            uci=move.uci,
            san=move.san,
            best_move_san=move.best_move_san,
            eval_before_mate=move.eval_before_mate,
            eval_after_mate=move.eval_after_mate,
            side_to_move=move.side_to_move,
            classification=move.classification,
        )
    db.commit()
    return len(rows)


def backfill_clock_times(db) -> int:
    game_ids = [
        row[0]
        for row in db.execute(
            select(MoveAnalysis.game_id).distinct().where(MoveAnalysis.clock_seconds.is_(None))
        )
    ]
    updated = 0
    for game_id in game_ids:
        game = db.get(Game, game_id)
        if game is None:
            continue
        parsed = chess.pgn.read_game(io.StringIO(game.pgn))
        if parsed is None:
            continue
        clocks_by_ply = parse_clocks_by_ply(parsed)
        if not clocks_by_ply:
            continue
        moves = list(db.scalars(select(MoveAnalysis).where(MoveAnalysis.game_id == game_id)))
        for move in moves:
            clock = clocks_by_ply.get(move.ply)
            if clock is not None:
                move.clock_seconds = clock
                updated += 1
        db.commit()
    return updated


def backfill_time_pressure_bands(db) -> int:
    """Runs off already-stored clock_seconds + Game.time_control -- no PGN
    re-parsing needed, unlike backfill_clock_times."""
    rows = list(
        db.execute(
            select(MoveAnalysis, Game)
            .join(Game, MoveAnalysis.game_id == Game.id)
            .where(MoveAnalysis.clock_seconds.isnot(None), MoveAnalysis.time_pressure_band.is_(None))
        )
    )
    for move, game in rows:
        move.time_pressure_band = band_for(move.clock_seconds, game.time_control)
    db.commit()
    return len(rows)


def main() -> None:
    db = SessionLocal()
    try:
        tagged = backfill_blunder_tags(db)
        clocked = backfill_clock_times(db)
        banded = backfill_time_pressure_bands(db)
    finally:
        db.close()
    print(f"Tagged {tagged} mistake/blunder rows, set clock_seconds on {clocked} rows, banded {banded} rows")


if __name__ == "__main__":
    main()
