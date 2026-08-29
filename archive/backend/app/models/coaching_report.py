from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CoachingReport(Base):
    """A generated coaching report is a cached Claude call, not a live view --
    profile stats shift by one game at a time and re-generating on every page
    load would be neither cheap nor meaningfully different. list-typed fields
    (strengths/weaknesses) are stored as a Text column holding a JSON array;
    SQLite has no native array type and this app has no other JSON column
    yet to justify a shared convention."""

    __tablename__ = "coaching_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    model: Mapped[str] = mapped_column(String(64))
    games_analyzed_count: Mapped[int] = mapped_column(Integer)

    headline: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(Text)
    strengths_json: Mapped[str] = mapped_column(Text)
    weaknesses_json: Mapped[str] = mapped_column(Text)
    focus_area: Mapped[str] = mapped_column(Text)
    opening_notes: Mapped[str] = mapped_column(Text)
    encouragement: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
