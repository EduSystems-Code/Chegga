"""Incremental Chess.com ingestion -- safe to re-run at any time."""
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.sync_state import SyncState
from app.services.chess_com_client import ChessComClient
from app.services.pgn_parser import normalize_game

logger = logging.getLogger(__name__)


def _current_year_month() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def _year_month_from_archive_url(url: str) -> str:
    # https://api.chess.com/pub/player/{user}/games/{YYYY}/{MM}
    parts = url.rstrip("/").split("/")
    year, month = parts[-2], parts[-1]
    return f"{year}-{month}"


def sync_games(
    db: Session,
    client: ChessComClient,
    username: str,
    on_progress: Callable[[int, int], None] | None = None,
) -> dict:
    """Pull every month of the user's Chess.com history not already marked
    complete. Games are upserted by chess_com_uuid, so re-running never
    duplicates rows; a month already fully fetched is skipped entirely
    except the current one, which can still receive new games.

    A first sync against a long history is many serial, throttled requests
    and can run for minutes -- on_progress(months_processed, games_added) is
    called after each month commits so a caller (the /api/sync/status route)
    can report real progress instead of looking stuck until the whole thing
    finishes."""
    archive_urls = client.get_archive_urls(username)
    current_month = _current_year_month()

    months_processed = 0
    games_added = 0

    for archive_url in archive_urls:
        year_month = _year_month_from_archive_url(archive_url)

        state = db.scalar(
            select(SyncState).where(SyncState.username == username, SyncState.year_month == year_month)
        )
        if state and state.status == "complete" and year_month != current_month:
            continue

        raw_games = client.get_archive(archive_url)
        added_this_month = 0

        for raw in raw_games:
            uuid = raw.get("uuid")
            if not uuid:
                continue
            exists = db.scalar(select(Game.id).where(Game.chess_com_uuid == uuid))
            if exists:
                continue
            try:
                fields = normalize_game(raw, username)
            except ValueError:
                logger.warning("Skipping game %s: tracked user not found among players", uuid)
                continue
            db.add(Game(**fields))
            added_this_month += 1

        if state is None:
            state = SyncState(username=username, year_month=year_month)
            db.add(state)
        state.status = "complete" if year_month != current_month else "partial"
        state.games_fetched = (state.games_fetched or 0) + added_this_month
        state.last_synced_at = datetime.utcnow()

        db.commit()

        months_processed += 1
        games_added += added_this_month
        logger.info("Synced %s: %d new games", year_month, added_this_month)
        if on_progress:
            on_progress(months_processed, games_added)

    return {"months_processed": months_processed, "games_added": games_added}
