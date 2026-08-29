from tests.conftest import make_game, make_move

from app.services.time_pressure_service import band_for, time_pressure_breakdown


def test_band_for_buckets_by_fraction_of_base_time():
    assert band_for(15.0, "300") == "critical (<10% time left)"  # 5%
    assert band_for(150.0, "300") == "comfortable (30-70%)"  # 50%
    assert band_for(280.0, "300") == "plenty (>70%)"  # ~93%


def test_band_for_correspondence_time_control_returns_none():
    assert band_for(100.0, "1/259200") is None


def test_band_for_missing_clock_returns_none():
    assert band_for(None, "300") is None


def test_time_pressure_breakdown_groups_by_precomputed_band(db_session):
    game = make_game(db_session, id=1, user_color="white", time_control="300")
    make_move(
        db_session, game, ply=1, side_to_move="white", clock_seconds=15.0, centipawn_loss=200,
        classification="blunder", time_pressure_band=band_for(15.0, "300"),
    )
    make_move(
        db_session, game, ply=3, side_to_move="white", clock_seconds=150.0, centipawn_loss=10,
        classification="best", time_pressure_band=band_for(150.0, "300"),
    )
    # opponent's move at low time -- must be excluded (not the tracked user)
    make_move(
        db_session, game, ply=2, side_to_move="black", clock_seconds=5.0, centipawn_loss=500,
        classification="blunder", time_pressure_band=band_for(5.0, "300"),
    )
    # never banded (e.g. analyzed before this feature existed) -- must not appear anywhere
    make_move(db_session, game, ply=5, side_to_move="white", clock_seconds=None, centipawn_loss=30, classification="good")

    buckets = time_pressure_breakdown(db_session)
    by_label = {b.label: b for b in buckets}

    assert len(buckets) == 4  # every band present, zero-filled, even with no data
    critical = by_label["critical (<10% time left)"]
    assert critical.moves == 1
    assert critical.avg_centipawn_loss == 200.0
    assert critical.blunder_rate == 1.0

    comfortable = by_label["comfortable (30-70%)"]
    assert comfortable.moves == 1
    assert comfortable.avg_centipawn_loss == 10.0
    assert comfortable.blunder_rate == 0.0

    assert by_label["low (10-30%)"].moves == 0
