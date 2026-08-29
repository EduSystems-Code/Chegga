"""Generates natural-language coaching feedback from the player's own
aggregate stats plus a sample of real illustrative blunders -- prose, not
just numbers, because "you hung a piece to a pin you'd already seen twice
this month" is coaching and "avg_cp_loss: 47" is not.

Reports are generated on demand, not automatically, and cached in
coaching_reports: profile stats shift by a game or two at a time, so
regenerating near-identical prose on every page load would be pure cost
with no benefit. Grounding is real -- the worst-blunder examples sent to
Claude are pulled straight from move_analyses, not summarized twice.
"""
import json
import logging

import anthropic
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.coaching_report import CoachingReport
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.services.profile_service import ProfileSummary, compute_profile

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5"
MIN_GAMES_FOR_COACHING = 10
_WORST_EXAMPLES = 8


class CoachingReportSchema(BaseModel):
    headline: str
    summary: str
    strengths: list[str]
    weaknesses: list[str]
    focus_area: str
    opening_notes: str
    encouragement: str


def _worst_examples(db: Session, limit: int = _WORST_EXAMPLES) -> list[dict]:
    rows = list(
        db.execute(
            select(MoveAnalysis, Game)
            .join(Game, MoveAnalysis.game_id == Game.id)
            .where(
                MoveAnalysis.side_to_move == Game.user_color,
                MoveAnalysis.classification == "blunder",
            )
            .order_by(MoveAnalysis.centipawn_loss.desc())
            .limit(limit)
        )
    )
    examples = []
    for move, game in rows:
        opponent = game.black_username if game.user_color == "white" else game.white_username
        examples.append(
            {
                "opponent": opponent,
                "opening": game.opening_name,
                "phase": move.game_phase,
                "ply": move.ply,
                "played": move.san,
                "best": move.best_move_san,
                "centipawn_loss": move.centipawn_loss,
                "result": game.user_result,
            }
        )
    return examples


def _build_prompt(profile: ProfileSummary, examples: list[dict]) -> str:
    profile_json = json.dumps(
        {
            "games_analyzed": profile.games_analyzed,
            "avg_centipawn_loss": profile.avg_centipawn_loss,
            "move_classification_rate": profile.classification_rate,
            "avg_cp_loss_by_phase": profile.phase_avg_cp_loss,
            "avg_cp_loss_by_color": profile.color_avg_cp_loss,
            "time_class_breakdown": profile.time_class_breakdown,
            "top_openings": [
                {"opening": o.opening_name, "games": o.games, "wins": o.wins, "losses": o.losses, "draws": o.draws}
                for o in profile.top_openings
            ],
        },
        indent=2,
    )
    examples_json = json.dumps(examples, indent=2)

    return (
        "You are a chess coach reviewing a student's aggregate play data, pulled "
        "from their real Chess.com game history and analyzed move-by-move with "
        "Stockfish. Write honest, specific, encouraging coaching feedback -- the "
        "kind a real coach gives after reviewing a batch of games, not a stats "
        "readout. Refer to concrete patterns visible in the data (openings, game "
        "phases, time controls, the example blunders below), not generic chess "
        "advice that would apply to anyone.\n\n"
        f"## Aggregate profile\n{profile_json}\n\n"
        f"## Worst blunders (a sample, worst centipawn loss first)\n{examples_json}\n"
    )


def generate_report(db: Session, settings: Settings) -> CoachingReport:
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set -- fill it in in backend/.env first")

    profile = compute_profile(db)
    if profile.games_analyzed < MIN_GAMES_FOR_COACHING:
        raise RuntimeError(
            f"Only {profile.games_analyzed} analyzed games so far "
            f"(need at least {MIN_GAMES_FOR_COACHING} for coaching feedback to mean anything)."
        )

    examples = _worst_examples(db)
    prompt = _build_prompt(profile, examples)

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        messages=[{"role": "user", "content": prompt}],
        output_format=CoachingReportSchema,
    )
    parsed = response.parsed_output

    report = CoachingReport(
        model=MODEL,
        games_analyzed_count=profile.games_analyzed,
        headline=parsed.headline,
        summary=parsed.summary,
        strengths_json=json.dumps(parsed.strengths),
        weaknesses_json=json.dumps(parsed.weaknesses),
        focus_area=parsed.focus_area,
        opening_notes=parsed.opening_notes,
        encouragement=parsed.encouragement,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


def latest_report(db: Session) -> CoachingReport | None:
    return db.scalar(select(CoachingReport).order_by(CoachingReport.created_at.desc()).limit(1))
