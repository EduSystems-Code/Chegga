from pydantic import BaseModel, ConfigDict

# from_attributes=True on all three: profile_service returns plain
# dataclasses (there's nothing to persist, so no ORM model backs these),
# and FastAPI's response_model validation needs attribute access enabled
# to read a non-dict, non-BaseModel object.


class OpeningStatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    opening_name: str
    games: int
    wins: int
    losses: int
    draws: int


class MonthlyStatOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    year_month: str
    games: int
    avg_centipawn_loss: float
    blunder_rate: float


class ProfileSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    games_analyzed: int
    total_moves: int
    avg_centipawn_loss: float
    classification_counts: dict[str, int]
    classification_rate: dict[str, float]
    phase_avg_cp_loss: dict[str, float]
    color_avg_cp_loss: dict[str, float]
    time_class_breakdown: dict[str, int]
    top_openings: list[OpeningStatOut]
    monthly_trend: list[MonthlyStatOut]
