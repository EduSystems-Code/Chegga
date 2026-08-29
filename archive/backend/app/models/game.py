from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Game(Base):
    __tablename__ = "games"
    __table_args__ = (UniqueConstraint("chess_com_uuid", name="uq_games_chess_com_uuid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chess_com_uuid: Mapped[str] = mapped_column(String(64), index=True)
    url: Mapped[str] = mapped_column(String(255))
    pgn: Mapped[str] = mapped_column(Text)

    time_control: Mapped[str] = mapped_column(String(32))
    time_class: Mapped[str] = mapped_column(String(32), index=True)
    rules: Mapped[str] = mapped_column(String(32), default="chess")
    rated: Mapped[bool] = mapped_column(Boolean, default=True)

    end_time: Mapped[int] = mapped_column(Integer, index=True)  # unix timestamp
    eco: Mapped[str | None] = mapped_column(String(255), nullable=True)
    opening_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    white_username: Mapped[str] = mapped_column(String(64))
    white_rating: Mapped[int] = mapped_column(Integer)
    black_username: Mapped[str] = mapped_column(String(64))
    black_rating: Mapped[int] = mapped_column(Integer)

    # Chess.com's own per-side result codes (e.g. "win", "checkmated",
    # "resigned") -- kept raw alongside the derived win/loss/draw below,
    # since the raw code is the only place "how" a game ended survives.
    white_result: Mapped[str] = mapped_column(String(32))
    black_result: Mapped[str] = mapped_column(String(32))

    user_color: Mapped[str] = mapped_column(String(8))   # 'white' | 'black'
    user_result: Mapped[str] = mapped_column(String(8))  # 'win' | 'loss' | 'draw'

    analyzed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    moves: Mapped[list["MoveAnalysis"]] = relationship(
        back_populates="game", cascade="all, delete-orphan", order_by="MoveAnalysis.ply"
    )
