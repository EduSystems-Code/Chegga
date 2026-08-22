from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.matchup import RatingGapBucketOut, RivalRecordOut
from app.services.matchup_service import head_to_head, rating_gap_performance

router = APIRouter()


@router.get("/matchups/rivals", response_model=list[RivalRecordOut])
def get_rivals(limit: int = Query(20, le=100), db: Session = Depends(get_db)) -> list[RivalRecordOut]:
    return head_to_head(db, limit=limit)


@router.get("/matchups/rating-gap", response_model=list[RatingGapBucketOut])
def get_rating_gap(db: Session = Depends(get_db)) -> list[RatingGapBucketOut]:
    return rating_gap_performance(db)
