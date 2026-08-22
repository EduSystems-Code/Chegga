import pytest

from app.services.pgn_parser import extract_opening_name, normalize_game, result_to_outcome

RAW_GAME = {
    "uuid": "game-1",
    "url": "https://www.chess.com/game/live/1",
    "pgn": "1. e4 e5 *",
    "time_control": "600",
    "time_class": "blitz",
    "rules": "chess",
    "rated": True,
    "end_time": 1700000000,
    "eco": "https://www.chess.com/openings/Italian-Game",
    "white": {"username": "testuser", "rating": 1200, "result": "win"},
    "black": {"username": "opponent", "rating": 1180, "result": "checkmated"},
}


def test_result_to_outcome_known_codes():
    assert result_to_outcome("win") == "win"
    assert result_to_outcome("checkmated") == "loss"
    assert result_to_outcome("agreed") == "draw"


def test_result_to_outcome_unknown_code_falls_back_to_draw():
    assert result_to_outcome("some_future_code_chess_com_might_add") == "draw"


def test_extract_opening_name_from_eco_url():
    assert extract_opening_name("https://www.chess.com/openings/Italian-Game") == "Italian Game"


def test_extract_opening_name_handles_missing_value():
    assert extract_opening_name(None) is None


def test_normalize_game_identifies_user_as_white():
    fields = normalize_game(RAW_GAME, "testuser")
    assert fields["user_color"] == "white"
    assert fields["user_result"] == "win"
    assert fields["chess_com_uuid"] == "game-1"


def test_normalize_game_identifies_user_as_black_case_insensitive():
    fields = normalize_game(RAW_GAME, "OPPONENT")
    assert fields["user_color"] == "black"
    assert fields["user_result"] == "loss"


def test_normalize_game_raises_when_user_not_in_game():
    with pytest.raises(ValueError):
        normalize_game(RAW_GAME, "someone_else")
