from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
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

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    game: Mapped["Game"] = relationship(back_populates="moves")
