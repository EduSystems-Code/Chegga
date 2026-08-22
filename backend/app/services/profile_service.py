"""Aggregates move_analyses + games into player-facing stats. Nothing here
is stored -- every number is re-derived from the two source tables on each
request, so there is no snapshot to drift out of sync with the underlying
data as more games get analyzed in the background.

"Player tracking" (seeing yourself change over time) is the monthly trend:
the same aggregation, grouped by the calendar month a game was played
rather than collapsed across all of history.
"""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis

_BLUNDER_LIKE = {"blunder", "mistake"}


@dataclass
class OpeningStat:
    opening_name: str
    games: int
    wins: int
    losses: int
    draws: int


@dataclass
class MonthlyStat:
    year_month: str  # "YYYY-MM"
    games: int
    avg_centipawn_loss: float
    blunder_rate: float  # blunders per game


@dataclass
class ProfileSummary:
    games_analyzed: int
    total_moves: int
    avg_centipawn_loss: float
    classification_counts: dict[str, int]
    classification_rate: dict[str, float]  # as a fraction of total_moves
    phase_avg_cp_loss: dict[str, float]  # opening/middlegame/endgame
    color_avg_cp_loss: dict[str, float]  # white/black
    time_class_breakdown: dict[str, int]
    top_openings: list[OpeningStat]
    monthly_trend: list[MonthlyStat] = field(default_factory=list)


def _own_moves_query(db: Session):
    """Every MoveAnalysis row where side_to_move matches the tracked
    account's color in that game -- i.e. only the user's own moves, never
    the opponent's, even though both sides' moves are stored."""
    return (
        select(MoveAnalysis, Game)
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color)
    )


def compute_profile(db: Session) -> ProfileSummary:
    rows = list(db.execute(_own_moves_query(db)))

    games_by_id: dict[int, Game] = {}
    total_cp_loss = 0
    classification_counts: dict[str, int] = defaultdict(int)
    phase_cp_loss: dict[str, list[int]] = defaultdict(list)
    color_cp_loss: dict[str, list[int]] = defaultdict(list)
    monthly: dict[str, list[int]] = defaultdict(list)
    monthly_blunders: dict[str, int] = defaultdict(int)
    monthly_games: dict[str, set[int]] = defaultdict(set)

    for move, game in rows:
        games_by_id[game.id] = game
        total_cp_loss += move.centipawn_loss
        classification_counts[move.classification] += 1
        phase_cp_loss[move.game_phase].append(move.centipawn_loss)
        color_cp_loss[game.user_color].append(move.centipawn_loss)

        ym = datetime.fromtimestamp(game.end_time, tz=timezone.utc).strftime("%Y-%m")
        monthly[ym].append(move.centipawn_loss)
        monthly_games[ym].add(game.id)
        if move.classification == "blunder":
            monthly_blunders[ym] += 1

    total_moves = sum(classification_counts.values())

    time_class_breakdown: dict[str, int] = defaultdict(int)
    for game in games_by_id.values():
        time_class_breakdown[game.time_class] += 1

    opening_stats: dict[str, OpeningStat] = {}
    for game in games_by_id.values():
        if not game.opening_name:
            continue
        stat = opening_stats.setdefault(
            game.opening_name, OpeningStat(opening_name=game.opening_name, games=0, wins=0, losses=0, draws=0)
        )
        stat.games += 1
        if game.user_result == "win":
            stat.wins += 1
        elif game.user_result == "loss":
            stat.losses += 1
        else:
            stat.draws += 1

    top_openings = sorted(opening_stats.values(), key=lambda s: s.games, reverse=True)[:10]

    monthly_trend = [
        MonthlyStat(
            year_month=ym,
            games=len(monthly_games[ym]),
            avg_centipawn_loss=round(sum(losses) / len(losses), 1) if losses else 0.0,
            blunder_rate=round(monthly_blunders[ym] / len(monthly_games[ym]), 2) if monthly_games[ym] else 0.0,
        )
        for ym, losses in sorted(monthly.items())
    ]

    return ProfileSummary(
        games_analyzed=len(games_by_id),
        total_moves=total_moves,
        avg_centipawn_loss=round(total_cp_loss / total_moves, 1) if total_moves else 0.0,
        classification_counts=dict(classification_counts),
        classification_rate={
            label: round(count / total_moves, 3) for label, count in classification_counts.items()
        }
        if total_moves
        else {},
        phase_avg_cp_loss={
            phase: round(sum(losses) / len(losses), 1) for phase, losses in phase_cp_loss.items() if losses
        },
        color_avg_cp_loss={
            color: round(sum(losses) / len(losses), 1) for color, losses in color_cp_loss.items() if losses
        },
        time_class_breakdown=dict(time_class_breakdown),
        top_openings=top_openings,
        monthly_trend=monthly_trend,
    )
