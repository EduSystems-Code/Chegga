"""Importing this package registers every model on Base.metadata -- required
before Base.metadata.create_all() or Alembic autogenerate can see them, and
before SQLAlchemy can resolve the string-quoted forward refs the Game <->
MoveAnalysis relationship uses."""
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.models.sync_state import SyncState

__all__ = ["Game", "MoveAnalysis", "SyncState"]
