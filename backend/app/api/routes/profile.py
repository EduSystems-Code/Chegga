from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.profile import ProfileSummaryOut
from app.services.profile_service import compute_profile

router = APIRouter()


@router.get("/profile", response_model=ProfileSummaryOut)
def get_profile(db: Session = Depends(get_db)) -> ProfileSummaryOut:
    return compute_profile(db)
