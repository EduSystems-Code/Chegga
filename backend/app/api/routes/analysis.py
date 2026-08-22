import logging

from fastapi import APIRouter, BackgroundTasks

from app.config import get_settings

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
def analysis_status() -> dict:
    return _status
