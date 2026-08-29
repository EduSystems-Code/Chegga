import logging

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import get_settings
from app.models.game import Game
from app.services.engine_analysis import SUPPORTED_RULES

logger = logging.getLogger(__name__)
router = APIRouter()

_status: dict = {"state": "idle", "games_analyzed": 0, "last_error": None}


def _run_analysis(limit: int | None) -> None:
    from app.db.session import SessionLocal
    from app.services.engine_analysis import analyze_pending_games

    settings = get_settings()
    _status.update(state="running", last_error=None)
    db = SessionLocal()
    try:
        count = analyze_pending_games(db, settings, limit=limit)
        _status.update(state="done", games_analyzed=count)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the status endpoint rather than crash
        logger.exception("Analysis failed")
        _status.update(state="error", last_error=str(exc))
    finally:
        db.close()


@router.post("/analysis/run")
def start_analysis(background_tasks: BackgroundTasks, limit: int = 20) -> dict:
    if _status["state"] == "running":
        return {"message": "Analysis already running"}
    background_tasks.add_task(_run_analysis, limit)
    return {"message": "Analysis started"}


@router.get("/analysis/status")
def analysis_status(db: Session = Depends(get_db)) -> dict:
    # Counts reflect the live backlog on every poll, independent of
    # _status -- a long-running CLI backfill (run_analysis.py, outside this
    # process) still moves these numbers even though it never touches
    # _status, which only tracks a run started through this API.
    total = db.scalar(select(func.count()).select_from(Game)) or 0
    analyzed = db.scalar(select(func.count()).select_from(Game).where(Game.analyzed.is_(True))) or 0
    pending = db.scalar(
        select(func.count()).select_from(Game).where(Game.analyzed.is_(False), Game.rules.in_(SUPPORTED_RULES))
    ) or 0
    return {**_status, "total_games": total, "analyzed_games": analyzed, "pending_games": pending}
