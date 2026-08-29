from pydantic import BaseModel, ConfigDict


class MoveAnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ply: int
    side_to_move: str
    san: str
    uci: str
    eval_before_cp: int | None
    eval_before_mate: int | None
    eval_after_cp: int | None
    eval_after_mate: int | None
    best_move_san: str | None
    centipawn_loss: int
    move_rank: int | None
    classification: str
    game_phase: str
    blunder_tag: str | None
    clock_seconds: float | None
