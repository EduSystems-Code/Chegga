import json

from pydantic import BaseModel, ConfigDict, field_validator


class CoachingReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    model: str
    games_analyzed_count: int
    headline: str
    summary: str
    strengths: list[str]
    weaknesses: list[str]
    focus_area: str
    opening_notes: str
    encouragement: str
    created_at: str

    @field_validator("strengths", "weaknesses", mode="before")
    @classmethod
    def _parse_json_list(cls, v: object) -> object:
        return json.loads(v) if isinstance(v, str) else v

    @field_validator("created_at", mode="before")
    @classmethod
    def _stringify_datetime(cls, v: object) -> object:
        return v.isoformat() if hasattr(v, "isoformat") else v


class CoachingStatus(BaseModel):
    state: str  # idle | running | done | error
    last_error: str | None = None
