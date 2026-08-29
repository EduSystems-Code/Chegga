"""Correlates move quality with clock time remaining -- "do you actually
play worse under time pressure," grounded in the real %clk data parsed
from each game's PGN, not a guess.

band_for() is called once per move at analysis time (engine_analysis.py)
and its result stored on MoveAnalysis.time_pressure_band. time_pressure_
breakdown() then does a plain GROUP BY over that column -- not a per-row
Python loop over every move -- which is the difference between an instant
query and one that gets slower every day as the analysis backlog grows
into the millions of rows. See backfill_move_metadata.py for existing rows
analyzed before this column existed.
"""
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.services.clock_parser import parse_time_control_base_seconds

# (label, fraction-of-base-time-remaining lower bound inclusive, upper bound exclusive)
_BANDS = [
    ("critical (<10% time left)", 0.0, 0.10),
    ("low (10-30%)", 0.10, 0.30),
    ("comfortable (30-70%)", 0.30, 0.70),
    ("plenty (>70%)", 0.70, 10.0),
]
_BAND_ORDER = [label for label, _, _ in _BANDS]


@dataclass
class TimePressureBucket:
    label: str
    moves: int
    avg_centipawn_loss: float
    blunder_rate: float


def band_for(clock_seconds: float | None, time_control: str) -> str | None:
    """Correspondence/daily games and moves missing a %clk annotation both
    yield None -- there's no meaningful "time pressure" to bucket."""
    if clock_seconds is None:
        return None
    base = parse_time_control_base_seconds(time_control)
    if not base:
        return None
    fraction = clock_seconds / base
    for label, lo, hi in _BANDS:
        if lo <= fraction < hi:
            return label
    return None


def time_pressure_breakdown(db: Session) -> list[TimePressureBucket]:
    """A plain GROUP BY over the precomputed band column -- O(distinct
    bands) rows come back regardless of how many million moves exist."""
    blunder_count = func.sum(case((MoveAnalysis.classification == "blunder", 1), else_=0))
    rows = db.execute(
        select(
            MoveAnalysis.time_pressure_band,
            func.count().label("moves"),
            func.avg(MoveAnalysis.centipawn_loss).label("avg_cp_loss"),
            blunder_count.label("blunders"),
        )
        .select_from(MoveAnalysis)
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color, MoveAnalysis.time_pressure_band.isnot(None))
        .group_by(MoveAnalysis.time_pressure_band)
    ).all()

    by_label = {
        band: TimePressureBucket(
            label=band,
            moves=moves,
            avg_centipawn_loss=round(avg_cp_loss, 1) if avg_cp_loss is not None else 0.0,
            blunder_rate=round(blunders / moves, 3) if moves else 0.0,
        )
        for band, moves, avg_cp_loss, blunders in rows
    }
    # Zero-filled in the fixed band order so the frontend always gets a
    # complete, consistently-ordered series rather than only whichever
    # bands happen to have data.
    return [by_label.get(label, TimePressureBucket(label=label, moves=0, avg_centipawn_loss=0.0, blunder_rate=0.0)) for label in _BAND_ORDER]
