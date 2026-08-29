"""Opponent-facing stats -- head-to-head records and performance by rating
gap. Both are pure aggregations over the Game table alone: no move-level
analysis required, so unlike profile_service these numbers are available
for every synced game immediately, not just the ones Stockfish has reached.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.game import Game

MIN_RIVAL_GAMES = 2  # a single game isn't a "rivalry" -- filters out the long tail of one-off opponents

# (label, lower bound inclusive, upper bound exclusive) of (opponent_rating - user_rating).
# Negative = opponent weaker than you; positive = opponent stronger.
_RATING_GAP_BANDS = [
    ("much weaker (-400 to -100)", -10_000, -100),
    ("weaker (-100 to -25)", -100, -25),
    ("even (-25 to +25)", -25, 25),
    ("stronger (+25 to +100)", 25, 100),
    ("much stronger (+100 to +400)", 100, 10_000),
]


@dataclass
class RivalRecord:
    opponent: str
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float


@dataclass
class RatingGapBucket:
    label: str
    games: int
    wins: int
    losses: int
    draws: int
    win_rate: float


def head_to_head(db: Session, limit: int = 20) -> list[RivalRecord]:
    games = list(db.scalars(select(Game)))

    records: dict[str, RivalRecord] = {}
    for game in games:
        opponent = game.black_username if game.user_color == "white" else game.white_username
        record = records.setdefault(opponent, RivalRecord(opponent=opponent, games=0, wins=0, losses=0, draws=0, win_rate=0.0))
        record.games += 1
        if game.user_result == "win":
            record.wins += 1
        elif game.user_result == "loss":
            record.losses += 1
        else:
            record.draws += 1

    rivals = [r for r in records.values() if r.games >= MIN_RIVAL_GAMES]
    for r in rivals:
        r.win_rate = round(r.wins / r.games, 3)
    rivals.sort(key=lambda r: r.games, reverse=True)
    return rivals[:limit]


def _user_rating(game: Game) -> int:
    return game.white_rating if game.user_color == "white" else game.black_rating


def _opponent_rating(game: Game) -> int:
    return game.black_rating if game.user_color == "white" else game.white_rating


def rating_gap_performance(db: Session) -> list[RatingGapBucket]:
    games = list(db.scalars(select(Game)))

    buckets = {label: RatingGapBucket(label=label, games=0, wins=0, losses=0, draws=0, win_rate=0.0) for label, _, _ in _RATING_GAP_BANDS}

    for game in games:
        gap = _opponent_rating(game) - _user_rating(game)
        for label, lo, hi in _RATING_GAP_BANDS:
            if lo <= gap < hi:
                bucket = buckets[label]
                bucket.games += 1
                if game.user_result == "win":
                    bucket.wins += 1
                elif game.user_result == "loss":
                    bucket.losses += 1
                else:
                    bucket.draws += 1
                break

    result = [buckets[label] for label, _, _ in _RATING_GAP_BANDS]
    for b in result:
        if b.games:
            b.win_rate = round(b.wins / b.games, 3)
    return result
