from datetime import datetime, timezone

from tests.conftest import make_game, make_move

from app.services.profile_service import compute_profile

JAN = int(datetime(2026, 1, 15, tzinfo=timezone.utc).timestamp())
FEB = int(datetime(2026, 2, 15, tzinfo=timezone.utc).timestamp())


def test_compute_profile_only_counts_the_tracked_users_own_moves(db_session):
    game1 = make_game(
        db_session, id=1, end_time=JAN, opening_name="Italian Game", user_color="white", user_result="win"
    )
    make_move(db_session, game1, ply=1, side_to_move="white", classification="best", centipawn_loss=0, game_phase="opening")
    make_move(db_session, game1, ply=2, side_to_move="black", classification="blunder", centipawn_loss=999, game_phase="opening")  # opponent -- must be excluded
    make_move(db_session, game1, ply=3, side_to_move="white", classification="blunder", centipawn_loss=300, game_phase="opening")

    game2 = make_game(
        db_session,
        id=2,
        end_time=FEB,
        opening_name="Sicilian Defense",
        user_color="black",
        user_result="loss",
        white_username="opponent2",
        black_username="MichaelBottega",
    )
    make_move(
        db_session, game2, ply=1, side_to_move="black", classification="mistake", centipawn_loss=120,
        game_phase="middlegame", blunder_tag="hung_material",
    )

    profile = compute_profile(db_session)

    assert profile.games_analyzed == 2
    assert profile.total_moves == 3  # the excluded opponent blunder must not appear anywhere
    assert profile.avg_centipawn_loss == round((0 + 300 + 120) / 3, 1)
    assert profile.classification_counts == {"best": 1, "blunder": 1, "mistake": 1}
    assert profile.phase_avg_cp_loss["opening"] == 150.0
    assert profile.phase_avg_cp_loss["middlegame"] == 120.0
    assert profile.color_avg_cp_loss["white"] == 150.0
    assert profile.color_avg_cp_loss["black"] == 120.0
    assert profile.time_class_breakdown == {"blitz": 2}
    assert profile.blunder_tag_counts == {"hung_material": 1}  # game1's untagged blunder must not appear

    openings = {o.opening_name: o for o in profile.top_openings}
    assert openings["Italian Game"].wins == 1
    assert openings["Sicilian Defense"].losses == 1

    trend_by_month = {m.year_month: m for m in profile.monthly_trend}
    assert trend_by_month["2026-01"].games == 1
    assert trend_by_month["2026-01"].avg_centipawn_loss == 150.0
    assert trend_by_month["2026-02"].games == 1
    assert trend_by_month["2026-02"].avg_centipawn_loss == 120.0


def test_compute_profile_on_empty_db_returns_zeros_not_a_crash(db_session):
    profile = compute_profile(db_session)
    assert profile.games_analyzed == 0
    assert profile.total_moves == 0
    assert profile.avg_centipawn_loss == 0.0
    assert profile.classification_rate == {}
    assert profile.monthly_trend == []
