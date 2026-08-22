from pydantic import BaseModel, ConfigDict


class DrillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)  # next_drill() returns a plain dataclass, not an ORM row

    move_analysis_id: int
    fen: str
    side_to_move: str
    game_id: int
    opponent: str
    opening_name: str | None
    move_history: list[str]
    accuracy: dict[str, int]


class DrillAttemptIn(BaseModel):
    chosen_san: str


class DrillAttemptOut(BaseModel):
    correct: bool
    correct_san: str


class DrillStatsOut(BaseModel):
    total_mistakes: int
    attempted: int
    solved: int
