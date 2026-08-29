from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.drill import DrillAttemptIn, DrillAttemptOut, DrillOut, DrillStatsOut
from app.services.drill_service import drill_stats, next_drill, record_attempt

router = APIRouter()


@router.get("/drills/next", response_model=DrillOut)
def get_next_drill(db: Session = Depends(get_db)) -> DrillOut:
    drill = next_drill(db)
    if drill is None:
        raise HTTPException(status_code=404, detail="No unsolved mistakes to drill -- nice work, or analyze more games")
    return drill


@router.post("/drills/{move_analysis_id}/attempt", response_model=DrillAttemptOut)
def attempt_drill(move_analysis_id: int, body: DrillAttemptIn, db: Session = Depends(get_db)) -> dict:
    try:
        return record_attempt(db, move_analysis_id, body.chosen_san)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/drills/stats", response_model=DrillStatsOut)
def get_drill_stats(db: Session = Depends(get_db)) -> dict:
    return drill_stats(db)
