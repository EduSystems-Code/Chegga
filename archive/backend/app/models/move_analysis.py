from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class MoveAnalysis(Base):
    __tablename__ = "move_analyses"
    __table_args__ = (UniqueConstraint("game_id", "ply", name="uq_move_analyses_game_ply"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("games.id", ondelete="CASCADE"), index=True)

    ply: Mapped[int] = mapped_column(Integer)  # 1-indexed half-move number
    side_to_move: Mapped[str] = mapped_column(String(8))  # 'white' | 'black' -- who made this move

    fen_before: Mapped[str] = mapped_column(String(96))
    san: Mapped[str] = mapped_column(String(16))
    uci: Mapped[str] = mapped_column(String(8))

    # All eval fields are White-relative centipawns (standard convention --
    # keeps an eval-over-time chart continuous instead of flipping sign
    # every ply). Centipawn loss below is computed by converting to the
    # mover's own perspective at compute time, not by storing it that way.
    eval_before_cp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_before_mate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_after_cp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_after_mate: Mapped[int | None] = mapped_column(Integer, nullable=True)

    best_move_uci: Mapped[str | None] = mapped_column(String(8), nullable=True)
    best_move_san: Mapped[str | None] = mapped_column(String(16), nullable=True)

    centipawn_loss: Mapped[int] = mapped_column(Integer, default=0)
    move_rank: Mapped[int | None] = mapped_column(Integer, nullable=True)  # null = outside top N

    # Our own convention -- no industry-standard thresholds exist for these
    # labels. See engine_analysis.classify() for the tunable cutoffs.
    classification: Mapped[str] = mapped_column(String(16))
    game_phase: Mapped[str] = mapped_column(String(16))  # opening/middlegame/endgame

    # WHY a mistake/blunder happened -- see blunder_tagger.tag_move() for the
    # heuristics. Null for anything better than a mistake (nothing to tag).
    blunder_tag: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # Chess.com's own %clk PGN annotation, parsed at analysis time -- clock
    # seconds remaining immediately after this move. Null for time controls
    # without a meaningful clock (daily/correspondence) or PGNs missing it.
    clock_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Which time_pressure_service band clock_seconds fell into, computed
    # once at analysis time rather than re-derived from clock_seconds +
    # Game.time_control on every profile page load -- with the move table
    # headed toward low millions of rows across the full history, a GROUP
    # BY on this column is the difference between a fast query and pulling
    # every row into Python to bucket it there. Same tradeoff already made
    # for blunder_tag: recomputed only by re-analysis if the band
    # boundaries ever change, not read live from a formula.
    time_pressure_band: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Drill generator state. Null = never drilled. False = shown and missed
    # (stays eligible, resurfaces). True = solved -- excluded from future
    # drills so practice always pushes toward what's still unfixed rather
    # than re-showing the same handful of blunders forever.
    drilled_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    drilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    game: Mapped["Game"] = relationship(back_populates="moves")
