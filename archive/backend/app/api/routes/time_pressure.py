from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.time_pressure import TimePressureBucketOut
from app.services.time_pressure_service import time_pressure_breakdown

router = APIRouter()


@router.get("/time-pressure", response_model=list[TimePressureBucketOut])
def get_time_pressure(db: Session = Depends(get_db)) -> list[TimePressureBucketOut]:
    return time_pressure_breakdown(db)
