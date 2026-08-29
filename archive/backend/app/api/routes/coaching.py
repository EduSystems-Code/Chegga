import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import get_settings
from app.schemas.coaching import CoachingReportOut, CoachingStatus
from app.services.coaching_service import generate_report, latest_report

logger = logging.getLogger(__name__)
router = APIRouter()

_status: dict = {"state": "idle", "last_error": None}


def _run_generation() -> None:
    from app.db.session import SessionLocal

    settings = get_settings()
    _status.update(state="running", last_error=None)
    db = SessionLocal()
    try:
        generate_report(db, settings)
        _status.update(state="done")
    except Exception as exc:  # noqa: BLE001 - surface any failure to the status endpoint rather than crash
        logger.exception("Coaching report generation failed")
        _status.update(state="error", last_error=str(exc))
    finally:
        db.close()


@router.post("/coaching/generate")
def start_generation(background_tasks: BackgroundTasks) -> dict:
    if _status["state"] == "running":
        return {"message": "Generation already running"}
    background_tasks.add_task(_run_generation)
    return {"message": "Generation started"}


@router.get("/coaching/status", response_model=CoachingStatus)
def generation_status() -> CoachingStatus:
    return CoachingStatus(**_status)


@router.get("/coaching/latest", response_model=CoachingReportOut)
def get_latest_report(db: Session = Depends(get_db)) -> CoachingReportOut:
    report = latest_report(db)
    if report is None:
        raise HTTPException(status_code=404, detail="No coaching report generated yet")
    return report
