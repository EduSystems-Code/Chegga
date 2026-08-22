"""Selects practice positions from the user's own unresolved mistakes and
blunders ("the ability to train") and records the outcome of an attempt.

A drill is multiple-choice (find Stockfish's best move among a few
options) rather than free-form board input -- this needed no drag-and-drop
board component to be a genuine recognition exercise, and the frontend
already has no chess-input widget to build one on top of.

drilled_correct is tri-state on MoveAnalysis: None = never drilled, False =
shown and missed (stays eligible -- it resurfaces until solved), True =
solved (excluded going forward). This is the only state a drill needs, so
it lives directly on the row being drilled rather than a separate table.
"""
import random
from dataclasses import dataclass
from datetime import datetime

import chess
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.game import Game
from app.models.move_analysis import MoveAnalysis

_DRILL_CLASSIFICATIONS = ("blunder", "mistake")
_NUM_CHOICES = 4


@dataclass
class DrillPosition:
    move_analysis_id: int
    fen: str
    side_to_move: str
    game_id: int
    opponent: str
    played_san: str
    choices: list[str]  # SAN, shuffled -- includes the correct answer


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

    board = chess.Board(move.fen_before)
    legal = list(board.legal_moves)
    played_move = chess.Move.from_uci(move.uci)
    best_move = chess.Move.from_uci(move.best_move_uci) if move.best_move_uci else None

    choice_moves = {played_move}
    if best_move:
        choice_moves.add(best_move)
    distractor_pool = [m for m in legal if m not in choice_moves]
    rng.shuffle(distractor_pool)
    for m in distractor_pool:
        if len(choice_moves) >= _NUM_CHOICES:
            break
        choice_moves.add(m)

    choice_sans = [board.san(m) for m in choice_moves]
    rng.shuffle(choice_sans)

    opponent = game.black_username if game.user_color == "white" else game.white_username

    return DrillPosition(
        move_analysis_id=move.id,
        fen=move.fen_before,
        side_to_move=move.side_to_move,
        game_id=game.id,
        opponent=opponent,
        played_san=move.san,
        choices=choice_sans,
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
