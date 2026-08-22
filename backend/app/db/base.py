from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base -- every model in app.models attaches here so
    Base.metadata (used by both Alembic and the startup create_all safety
    net) sees the whole schema in one place."""
