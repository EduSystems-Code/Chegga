"""Selects practice positions from the user's own unresolved mistakes and
blunders ("the ability to train") and records the outcome of an attempt.

Answers are entered by dragging a piece on a real board (chess.js validates
legality and produces SAN client-side); the backend's job is just to grade
whatever SAN comes back against the engine's best move -- record_attempt
doesn't care whether that SAN came from a drag or (previously) a button.

drilled_correct is tri-state on MoveAnalysis: None = never drilled, False =
shown and missed (stays eligible -- it resurfaces until solved), True =
solved (excluded going forward). This is the only state a drill needs, so
it lives directly on the row being drilled rather than a separate table.
"""
import random
from dataclasses import dataclass, field
from datetime import datetime

import chess
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis

_DRILL_CLASSIFICATIONS = ("blunder", "mistake")


@dataclass
class DrillPosition:
    move_analysis_id: int
    fen: str
    side_to_move: str
    game_id: int
    opponent: str
    played_san: str
    opening_name: str | None
    # SAN move list for the whole game, ply 1 .. (this move's ply - 1) --
    # "the notation of the game to get you to this position." Both colors,
    # in order, so the frontend can pair them into "1. e4 e5 2. Nf3 ...".
    move_history: list[str] = field(default_factory=list)
    # Classification counts for the tracked user's own moves in THIS game,
    # ply 1 through this move's ply inclusive -- the same shape as
    # ProfileSummary.classification_counts, just scoped to one game's
    # prefix instead of the whole account, for the accuracy bar.
    accuracy: dict[str, int] = field(default_factory=dict)


def _own_mistakes_query(db: Session):
    return (
        select(MoveAnalysis, Game)
        .join(Game, MoveAnalysis.game_id == Game.id)
        .where(
            MoveAnalysis.side_to_move == Game.user_color,
            MoveAnalysis.classification.in_(_DRILL_CLASSIFICATIONS),
            MoveAnalysis.drilled_correct.isnot(True),
        )
    )


def _correct_san(board: chess.Board, move: MoveAnalysis) -> str:
    if move.best_move_uci:
        return board.san(chess.Move.from_uci(move.best_move_uci))
    return move.san  # no recorded best move (should not happen past classify()) -- fail safe, not fail loud


def next_drill(db: Session, rng: random.Random | None = None) -> DrillPosition | None:
    rng = rng or random.Random()
    rows = list(db.execute(_own_mistakes_query(db)))
    if not rows:
        return None

    # Weight toward the more severe misses -- practice time should go to
    # what actually cost the most, not spread evenly over small mistakes.
    weights = [max(1, move.centipawn_loss) for move, _ in rows]
    move, game = rng.choices(rows, weights=weights, k=1)[0]

    opponent = game.black_username if game.user_color == "white" else game.white_username

    history_rows = list(
        db.scalars(
            select(MoveAnalysis)
            .where(MoveAnalysis.game_id == game.id, MoveAnalysis.ply < move.ply)
            .order_by(MoveAnalysis.ply)
        )
    )
    move_history = [m.san for m in history_rows]

    own_rows_so_far = list(
        db.scalars(
            select(MoveAnalysis).where(
                MoveAnalysis.game_id == game.id,
                MoveAnalysis.side_to_move == game.user_color,
                MoveAnalysis.ply <= move.ply,
            )
        )
    )
    accuracy: dict[str, int] = {}
    for m in own_rows_so_far:
        accuracy[m.classification] = accuracy.get(m.classification, 0) + 1

    return DrillPosition(
        move_analysis_id=move.id,
        fen=move.fen_before,
        side_to_move=move.side_to_move,
        game_id=game.id,
        opponent=opponent,
        played_san=move.san,
        opening_name=game.opening_name,
        move_history=move_history,
        accuracy=accuracy,
    )


def record_attempt(db: Session, move_analysis_id: int, chosen_san: str) -> dict:
    move = db.get(MoveAnalysis, move_analysis_id)
    if move is None:
        raise ValueError(f"No move_analysis {move_analysis_id}")

    board = chess.Board(move.fen_before)
    correct_san = _correct_san(board, move)
    correct = chosen_san == correct_san

    move.drilled_correct = correct
    move.drilled_at = datetime.utcnow()
    db.commit()

    return {"correct": correct, "correct_san": correct_san}


def drill_stats(db: Session) -> dict:
    rows = list(db.scalars(select(MoveAnalysis).where(MoveAnalysis.classification.in_(_DRILL_CLASSIFICATIONS))))
    total = len(rows)
    solved = sum(1 for m in rows if m.drilled_correct is True)
    attempted = sum(1 for m in rows if m.drilled_correct is not None)
    return {"total_mistakes": total, "attempted": attempted, "solved": solved}
