import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import get_settings
from app.schemas.strength import StrengthPredictionOut, StrengthTrainStatus
from app.services.strength_model import load_meta, predict_all, train_model

logger = logging.getLogger(__name__)
router = APIRouter()

_status: dict = {"state": "idle", "last_error": None}


def _run_training() -> None:
    from app.db.session import SessionLocal

    _status.clear()
    _status.update(state="running", last_error=None)
    db = SessionLocal()
    try:
        result = train_model(db, get_settings())
        _status.update(state="done", **result.__dict__)
    except Exception as exc:  # noqa: BLE001 - surface any failure to the status endpoint rather than crash
        logger.exception("Strength model training failed")
        _status.update(state="error", last_error=str(exc))
    finally:
        db.close()


@router.post("/strength/train")
def start_training(background_tasks: BackgroundTasks) -> dict:
    if _status["state"] == "running":
        return {"message": "Training already running"}
    background_tasks.add_task(_run_training)
    return {"message": "Training started"}


@router.get("/strength/status", response_model=StrengthTrainStatus)
def training_status() -> StrengthTrainStatus:
    meta = load_meta(get_settings())
    if _status["state"] == "idle" and meta:
        return StrengthTrainStatus(state="done", **meta.__dict__)
    return StrengthTrainStatus(**_status)


@router.get("/strength/predictions", response_model=list[StrengthPredictionOut])
def get_predictions(db: Session = Depends(get_db)) -> list[dict]:
    try:
        return predict_all(db, get_settings())
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
