"""Exercises coaching_service without ever calling the real Anthropic API --
generate_report()'s guard clauses run for real, and the happy path mocks
anthropic.Anthropic so the DB-write/parsing logic is verified without
spending a cent or needing a key configured."""
from unittest.mock import MagicMock, patch

import pytest
from tests.conftest import make_game, make_move

from app.config import Settings
from app.models.coaching_report import CoachingReport
from app.services.coaching_service import (
    MIN_GAMES_FOR_COACHING,
    CoachingReportSchema,
    _worst_examples,
    generate_report,
    latest_report,
)


def _settings(**overrides) -> Settings:
    defaults = dict(anthropic_api_key="sk-fake-test-key")
    defaults.update(overrides)
    return Settings(**defaults)


def _seed_games_with_blunders(db, count: int):
    for i in range(count):
        game = make_game(db, id=i + 1, user_color="white", opening_name=f"Opening {i}")
        make_move(db, game, ply=1, side_to_move="white", classification="best", centipawn_loss=0)
        make_move(
            db, game, ply=3, side_to_move="white", classification="blunder", centipawn_loss=100 + i * 10,
            san="Qxh7", best_move_san="Nf3",
        )


def test_generate_report_refuses_without_api_key(db_session):
    _seed_games_with_blunders(db_session, MIN_GAMES_FOR_COACHING)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        generate_report(db_session, _settings(anthropic_api_key=None))


def test_generate_report_refuses_below_min_games(db_session):
    _seed_games_with_blunders(db_session, MIN_GAMES_FOR_COACHING - 1)
    with pytest.raises(RuntimeError, match="need at least"):
        generate_report(db_session, _settings())


def test_worst_examples_only_includes_own_blunders_worst_first(db_session):
    game = make_game(db_session, id=1, user_color="white")
    make_move(db_session, game, ply=1, side_to_move="white", classification="blunder", centipawn_loss=150)
    make_move(db_session, game, ply=2, side_to_move="black", classification="blunder", centipawn_loss=900)  # opponent's -- must be excluded
    make_move(db_session, game, ply=3, side_to_move="white", classification="mistake", centipawn_loss=80)  # not a blunder -- excluded
    make_move(db_session, game, ply=5, side_to_move="white", classification="blunder", centipawn_loss=400)

    examples = _worst_examples(db_session)

    assert [e["centipawn_loss"] for e in examples] == [400, 150]


def test_generate_report_happy_path_persists_parsed_output(db_session):
    _seed_games_with_blunders(db_session, MIN_GAMES_FOR_COACHING)

    fake_parsed = CoachingReportSchema(
        headline="Solid but blunder-prone",
        summary="You play sound openings but drop material under pressure.",
        strengths=["Opening preparation", "Endgame technique"],
        weaknesses=["Tactical alertness", "Time pressure decisions"],
        focus_area="Slow down before captures in sharp positions.",
        opening_notes="Your Queen's Gambit repertoire scores well.",
        encouragement="The pattern is fixable -- it's one specific habit, not a skill gap.",
    )
    fake_response = MagicMock(parsed_output=fake_parsed)
    fake_client = MagicMock()
    fake_client.messages.parse.return_value = fake_response

    with patch("app.services.coaching_service.anthropic.Anthropic", return_value=fake_client) as mock_ctor:
        report = generate_report(db_session, _settings())

    mock_ctor.assert_called_once_with(api_key="sk-fake-test-key")
    assert fake_client.messages.parse.call_args.kwargs["output_format"] is CoachingReportSchema

    assert isinstance(report, CoachingReport)
    assert report.headline == "Solid but blunder-prone"
    assert report.games_analyzed_count == MIN_GAMES_FOR_COACHING
    assert "Opening preparation" in report.strengths_json

    fetched = latest_report(db_session)
    assert fetched is not None
    assert fetched.id == report.id
