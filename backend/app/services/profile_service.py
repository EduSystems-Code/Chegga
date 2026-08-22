"""Aggregates move_analyses + games into player-facing stats. Nothing here
is stored -- every number is re-derived from the two source tables on each
request, so there is no snapshot to drift out of sync with the underlying
data as more games get analyzed in the background.

Every query here is a SQL-side GROUP BY, not a Python loop over fetched
rows. With move_analyses headed toward low millions of rows across the
full 21k-game history, pulling every row into Python (the original version
of this file) turned a single page load into several seconds and climbing
-- a GROUP BY returns one row per classification/phase/opening/month
regardless of how many underlying moves exist, so this stays fast for the
life of the dataset.

"Player tracking" (seeing yourself change over time) is the monthly trend:
the same aggregation, grouped by the calendar month a game was played
rather than collapsed across all of history.
"""
from dataclasses import dataclass, field

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis


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
    blunder_tag_counts: dict[str, int] = field(default_factory=dict)
    monthly_trend: list[MonthlyStat] = field(default_factory=list)


def _classification_counts(db: Session) -> tuple[dict[str, int], int, int]:
    stmt = (
        select(MoveAnalysis.classification, func.count(), func.sum(MoveAnalysis.centipawn_loss))
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color)
        .group_by(MoveAnalysis.classification)
    )
    counts: dict[str, int] = {}
    total_moves = 0
    total_cp_loss = 0
    for classification, count, cp_sum in db.execute(stmt):
        counts[classification] = count
        total_moves += count
        total_cp_loss += cp_sum or 0
    return counts, total_moves, total_cp_loss


def _blunder_tag_counts(db: Session) -> dict[str, int]:
    stmt = (
        select(MoveAnalysis.blunder_tag, func.count())
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color, MoveAnalysis.blunder_tag.isnot(None))
        .group_by(MoveAnalysis.blunder_tag)
    )
    return {tag: count for tag, count in db.execute(stmt)}


def _avg_cp_loss_by(db: Session, group_col) -> dict[str, float]:
    stmt = (
        select(group_col, func.avg(MoveAnalysis.centipawn_loss))
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color)
        .group_by(group_col)
    )
    return {key: round(avg, 1) for key, avg in db.execute(stmt) if key is not None}


def _games_analyzed_count(db: Session) -> int:
    stmt = (
        select(func.count(func.distinct(MoveAnalysis.game_id)))
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color)
    )
    return db.scalar(stmt) or 0


def _time_class_breakdown(db: Session) -> dict[str, int]:
    stmt = select(Game.time_class, func.count()).where(Game.analyzed.is_(True)).group_by(Game.time_class)
    return {time_class: count for time_class, count in db.execute(stmt)}


def _top_openings(db: Session, limit: int = 10) -> list[OpeningStat]:
    stmt = (
        select(Game.opening_name, Game.user_result, func.count())
        .where(Game.analyzed.is_(True), Game.opening_name.isnot(None))
        .group_by(Game.opening_name, Game.user_result)
    )
    stats: dict[str, OpeningStat] = {}
    for opening_name, result, count in db.execute(stmt):
        stat = stats.setdefault(opening_name, OpeningStat(opening_name=opening_name, games=0, wins=0, losses=0, draws=0))
        stat.games += count
        if result == "win":
            stat.wins += count
        elif result == "loss":
            stat.losses += count
        else:
            stat.draws += count
    return sorted(stats.values(), key=lambda s: s.games, reverse=True)[:limit]


def _monthly_trend(db: Session) -> list[MonthlyStat]:
    year_month = func.strftime("%Y-%m", Game.end_time, "unixepoch")

    games_stmt = select(year_month, func.count()).where(Game.analyzed.is_(True)).group_by(year_month)
    games_by_month = {ym: count for ym, count in db.execute(games_stmt)}

    blunder_count = func.sum(case((MoveAnalysis.classification == "blunder", 1), else_=0))
    moves_stmt = (
        select(year_month, func.avg(MoveAnalysis.centipawn_loss), blunder_count)
        .select_from(MoveAnalysis)
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(MoveAnalysis.side_to_move == Game.user_color)
        .group_by(year_month)
    )

    trend = []
    for ym, avg_cp_loss, blunders in db.execute(moves_stmt):
        games = games_by_month.get(ym, 0)
        trend.append(
            MonthlyStat(
                year_month=ym,
                games=games,
                avg_centipawn_loss=round(avg_cp_loss, 1) if avg_cp_loss is not None else 0.0,
                blunder_rate=round(blunders / games, 2) if games else 0.0,
            )
        )
    trend.sort(key=lambda m: m.year_month)
    return trend


def compute_profile(db: Session) -> ProfileSummary:
    classification_counts, total_moves, total_cp_loss = _classification_counts(db)

    return ProfileSummary(
        games_analyzed=_games_analyzed_count(db),
        total_moves=total_moves,
        avg_centipawn_loss=round(total_cp_loss / total_moves, 1) if total_moves else 0.0,
        classification_counts=classification_counts,
        classification_rate={label: round(count / total_moves, 3) for label, count in classification_counts.items()}
        if total_moves
        else {},
        phase_avg_cp_loss=_avg_cp_loss_by(db, MoveAnalysis.game_phase),
        color_avg_cp_loss=_avg_cp_loss_by(db, Game.user_color),
        time_class_breakdown=_time_class_breakdown(db),
        top_openings=_top_openings(db),
        blunder_tag_counts=_blunder_tag_counts(db),
        monthly_trend=_monthly_trend(db),
    )
