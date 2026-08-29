"""Shared fixtures for tests that need a real (in-memory) DB session --
Phase 3's services aggregate across Game + MoveAnalysis rows, which is
awkward to exercise meaningfully without one."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.db.base import Base
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()


def make_game(db: Session, **overrides) -> Game:
    defaults = dict(
        chess_com_uuid=f"uuid-{overrides.get('id', id(overrides))}",
        url="https://www.chess.com/game/live/1",
        pgn="1. e4 e5 *",
        time_control="600",
        time_class="blitz",
        rules="chess",
        rated=True,
        end_time=1_700_000_000,
        eco=None,
        opening_name="Italian Game",
        white_username="MichaelBottega",
        white_rating=1800,
        black_username="opponent",
        black_rating=1750,
        white_result="win",
        black_result="checkmated",
        user_color="white",
        user_result="win",
        analyzed=True,
    )
    defaults.update(overrides)
    game = Game(**defaults)
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


def make_move(db: Session, game: Game, **overrides) -> MoveAnalysis:
    defaults = dict(
        game_id=game.id,
        ply=1,
        side_to_move="white",
        fen_before="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        san="e4",
        uci="e2e4",
        eval_before_cp=30,
        eval_before_mate=None,
        eval_after_cp=30,
        eval_after_mate=None,
        best_move_uci="e2e4",
        best_move_san="e4",
        centipawn_loss=0,
        move_rank=1,
        classification="best",
        game_phase="opening",
    )
    defaults.update(overrides)
    move = MoveAnalysis(**defaults)
    db.add(move)
    db.commit()
    db.refresh(move)
    return move
