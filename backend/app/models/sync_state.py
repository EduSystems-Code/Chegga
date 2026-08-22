from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SyncState(Base):
    """One row per (username, year-month) archive. A month past the current
    one never changes on Chess.com's side once fully fetched, so it's safe
    to mark 'complete' and skip on every future sync; the current month is
    always re-fetched since it can still receive new games."""

    __tablename__ = "sync_state"
    __table_args__ = (UniqueConstraint("username", "year_month", name="uq_sync_state_username_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), index=True)
    year_month: Mapped[str] = mapped_column(String(7))  # "2024-01"
    status: Mapped[str] = mapped_column(String(16), default="partial")  # 'partial' | 'complete'
    games_fetched: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
