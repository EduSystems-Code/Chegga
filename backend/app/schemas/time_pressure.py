from pydantic import BaseModel, ConfigDict


class TimePressureBucketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    label: str
    moves: int
    avg_centipawn_loss: float
    blunder_rate: float
