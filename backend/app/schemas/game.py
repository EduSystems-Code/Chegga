from pydantic import BaseModel, ConfigDict

from app.schemas.move import MoveAnalysisOut


class GameSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    chess_com_uuid: str
    url: str
    time_class: str
    rated: bool
    end_time: int
    eco: str | None
    opening_name: str | None
    white_username: str
    white_rating: int
    black_username: str
    black_rating: int
    user_color: str
    user_result: str
    analyzed: bool


class GameDetail(GameSummary):
    pgn: str
    moves: list[MoveAnalysisOut] = []


class SyncStatus(BaseModel):
    state: str  # idle | running | done | error
    months_processed: int = 0
    games_added: int = 0
    last_error: str | None = None


class SyncStartResponse(BaseModel):
    message: str
