import logging

from fastapi import APIRouter, BackgroundTasks

from app.config import get_settings
from app.schemas.game import SyncStartResponse, SyncStatus
from app.services.chess_com_client import ChessComClient
from app.services.sync_service import sync_games

logger = logging.getLogger(__name__)
router = APIRouter()

# Single-user, localhost-only app: an in-process status dict is sufficient --
# a restart resets it to idle, which is fine, there's no queue to recover.
_status: dict = {"state": "idle", "months_processed": 0, "games_added": 0, "last_error": None}


def _run_sync() -> None:
    from app.db.session import SessionLocal  # deferred: avoid a hard import-time dependency for tests

    settings = get_settings()
    if not settings.chess_com_username or not settings.chess_com_contact:
        _status.update(
            state="error",
            last_error="Set CHESS_COM_USERNAME and CHESS_COM_CONTACT in backend/.env first",
        )
        return

    _status.update(state="running", last_error=None, months_processed=0, games_added=0)
    db = SessionLocal()
    try:
        client = ChessComClient(contact=settings.chess_com_contact)

        def report_progress(months_processed: int, games_added: int) -> None:
            _status.update(months_processed=months_processed, games_added=games_added)

        result = sync_games(db, client, settings.chess_com_username, on_progress=report_progress)
        _status.update(state="done", **result)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the status endpoint rather than crash
        logger.exception("Sync failed")
        _status.update(state="error", last_error=str(exc))
    finally:
        db.close()


@router.post("/sync", response_model=SyncStartResponse)
def start_sync(background_tasks: BackgroundTasks) -> SyncStartResponse:
    if _status["state"] == "running":
        return SyncStartResponse(message="Sync already running")
    background_tasks.add_task(_run_sync)
    return SyncStartResponse(message="Sync started")


@router.get("/sync/status", response_model=SyncStatus)
def sync_status() -> SyncStatus:
    return SyncStatus(**_status)
