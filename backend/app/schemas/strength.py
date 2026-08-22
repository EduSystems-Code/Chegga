from pydantic import BaseModel


class StrengthTrainStatus(BaseModel):
    state: str  # idle | running | done | error
    n_samples: int | None = None
    cv_folds: int | None = None
    cv_mae: float | None = None
    cv_r2: float | None = None
    trained_at: str | None = None
    last_error: str | None = None


class StrengthPredictionOut(BaseModel):
    game_id: int
    end_time: int
    time_class: str
    actual_rating: int
    predicted_rating: float
