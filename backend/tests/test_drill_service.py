import random

from tests.conftest import make_game, make_move

from app.services.drill_service import drill_stats, next_drill, record_attempt

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


def _make_blunder(db_session, game, **overrides):
    defaults = dict(
        ply=1,
        side_to_move="white",
        fen_before=START_FEN,
        san="e4",
        uci="e2e4",
        best_move_uci="d2d4",
        best_move_san="d4",
        classification="blunder",
        centipawn_loss=250,
        game_phase="opening",
    )
    defaults.update(overrides)
    return make_move(db_session, game, **defaults)


def test_next_drill_only_offers_the_users_own_unsolved_mistakes(db_session):
    game = make_game(db_session, id=1, user_color="white")
    _make_blunder(db_session, game, ply=1, side_to_move="white")  # eligible
    _make_blunder(db_session, game, ply=2, side_to_move="black", best_move_uci="d7d5", best_move_san="d5")  # opponent's -- must be excluded
    make_move(db_session, game, ply=3, side_to_move="white", classification="best", centipawn_loss=0)  # not a mistake -- excluded

    drill = next_drill(db_session, rng=random.Random(0))

    assert drill is not None
    assert drill.side_to_move == "white"
    assert "d4" in drill.choices  # the correct answer must always be offered
    assert len(drill.choices) == len(set(drill.choices))  # no duplicate options


def test_next_drill_returns_none_when_nothing_eligible(db_session):
    game = make_game(db_session, id=1, user_color="white")
    make_move(db_session, game, ply=1, side_to_move="white", classification="best", centipawn_loss=0)

    assert next_drill(db_session, rng=random.Random(0)) is None


def test_record_attempt_marks_correct_and_excludes_from_future_drills(db_session):
    game = make_game(db_session, id=1, user_color="white")
    move = _make_blunder(db_session, game, ply=1, side_to_move="white")

    result = record_attempt(db_session, move.id, "d4")
    assert result == {"correct": True, "correct_san": "d4"}

    # solved -- must no longer surface
    assert next_drill(db_session, rng=random.Random(0)) is None


def test_record_attempt_marks_incorrect_and_stays_eligible(db_session):
    game = make_game(db_session, id=1, user_color="white")
    move = _make_blunder(db_session, game, ply=1, side_to_move="white")

    result = record_attempt(db_session, move.id, "e4")  # the move that was actually played -- wrong answer
    assert result == {"correct": False, "correct_san": "d4"}

    drill = next_drill(db_session, rng=random.Random(0))
    assert drill is not None
    assert drill.move_analysis_id == move.id


def test_drill_stats_counts_attempted_and_solved(db_session):
    game = make_game(db_session, id=1, user_color="white")
    solved = _make_blunder(db_session, game, ply=1, side_to_move="white")
    missed = _make_blunder(db_session, game, ply=3, side_to_move="white")
    _make_blunder(db_session, game, ply=5, side_to_move="white")  # never attempted

    record_attempt(db_session, solved.id, "d4")
    record_attempt(db_session, missed.id, "e4")

    stats = drill_stats(db_session)
    assert stats == {"total_mistakes": 3, "attempted": 2, "solved": 1}
