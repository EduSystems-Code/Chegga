from pydantic import BaseModel, ConfigDict


class RivalRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    opponent: str
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float


class RatingGapBucketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    label: str
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float
