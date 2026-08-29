from tests.conftest import make_game

from app.services.matchup_service import MIN_RIVAL_GAMES, head_to_head, rating_gap_performance


def test_head_to_head_excludes_one_off_opponents(db_session):
    # Two games vs "regular" -- a real rivalry.
    make_game(db_session, id=1, white_username="MichaelBottega", black_username="regular", user_color="white", user_result="win")
    make_game(db_session, id=2, white_username="regular", black_username="MichaelBottega", user_color="black", user_result="loss")
    # One game vs "stranger" -- below MIN_RIVAL_GAMES, must not appear.
    make_game(db_session, id=3, white_username="MichaelBottega", black_username="stranger", user_color="white", user_result="win")

    rivals = head_to_head(db_session)

    assert len(rivals) == 1
    assert rivals[0].opponent == "regular"
    assert rivals[0].games == 2
    assert rivals[0].wins == 1
    assert rivals[0].losses == 1
    assert rivals[0].win_rate == 0.5


def test_head_to_head_respects_min_rival_games_constant(db_session):
    assert MIN_RIVAL_GAMES == 2  # documents the cutoff the test above relies on


def test_head_to_head_caps_result_count(db_session):
    # 5 distinct opponents, 2 games each -- all qualify as rivals, but limit=2 must cap it.
    for i in range(5):
        make_game(db_session, id=i * 2 + 1, white_username="MichaelBottega", black_username=f"opp{i}", user_color="white")
        make_game(db_session, id=i * 2 + 2, white_username=f"opp{i}", black_username="MichaelBottega", user_color="black")

    rivals = head_to_head(db_session, limit=2)
    assert len(rivals) == 2


def test_rating_gap_performance_buckets_correctly(db_session):
    # User 1800, opponent 1850 -> gap +50 -> "stronger" band, a win (an upset).
    make_game(
        db_session, id=1, user_color="white", user_result="win",
        white_rating=1800, black_rating=1850,
    )
    # User 1800, opponent 1600 -> gap -200 -> "much weaker" band, a loss.
    make_game(
        db_session, id=2, user_color="white", user_result="loss",
        white_rating=1800, black_rating=1600,
    )

    buckets = rating_gap_performance(db_session)
    by_label = {b.label: b for b in buckets}

    stronger = by_label["stronger (+25 to +100)"]
    assert stronger.games == 1
    assert stronger.wins == 1
    assert stronger.win_rate == 1.0

    much_weaker = by_label["much weaker (-400 to -100)"]
    assert much_weaker.games == 1
    assert much_weaker.losses == 1

    even = by_label["even (-25 to +25)"]
    assert even.games == 0
    assert even.win_rate == 0.0  # empty bucket must not divide by zero
