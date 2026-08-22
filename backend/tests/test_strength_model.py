import pytest
from tests.conftest import make_game, make_move

from app.config import Settings
from app.services.engine_analysis import classify
from app.services.strength_model import (
    FEATURE_NAMES,
    MIN_OWN_MOVES,
    MIN_TRAINING_GAMES,
    build_training_data,
    extract_features,
    load_meta,
    load_model,
    predict_all,
    train_model,
)

PHASES = ["opening", "opening", "middlegame", "middlegame", "middlegame", "endgame", "endgame"]


def _settings(tmp_path) -> Settings:
    return Settings(strength_model_dir=str(tmp_path))


def _seed_game(db_session, index: int, strong: bool):
    """A "strong" synthetic game has low centipawn loss throughout and a
    high rating; a "weak" one has the opposite -- real correlated signal
    for the model to actually fit, not just structurally valid rows."""
    color = "white" if index % 2 == 0 else "black"
    rating = 2000 if strong else 1200
    game = make_game(
        db_session,
        id=index,
        end_time=1_700_000_000 + index * 86400,
        user_color=color,
        white_rating=rating if color == "white" else 1500,
        black_rating=rating if color == "black" else 1500,
        white_username="MichaelBottega" if color == "white" else "opponent",
        black_username="MichaelBottega" if color == "black" else "opponent",
    )
    cp_losses = [5, 10, 8, 12, 6, 9, 7] if strong else [150, 200, 180, 220, 160, 190, 170]
    for i, (cp, phase) in enumerate(zip(cp_losses, PHASES)):
        make_move(
            db_session,
            game,
            ply=i + 1,
            side_to_move=color,
            classification=classify(cp),
            centipawn_loss=cp,
            game_phase=phase,
        )
    return game


def test_extract_features_returns_none_below_min_own_moves(db_session):
    game = _seed_game(db_session, 0, strong=True)
    # Trim down to fewer than MIN_OWN_MOVES by only passing a short slice
    short_moves = game.moves[: MIN_OWN_MOVES - 1]
    assert extract_features(game, short_moves) is None


def test_extract_features_shape_matches_feature_names(db_session):
    game = _seed_game(db_session, 0, strong=True)
    features = extract_features(game, game.moves)
    assert features is not None
    assert set(features.keys()) == set(FEATURE_NAMES)
    assert features["is_white"] == 1.0
    assert features["time_class_blitz"] == 1.0
    assert features["time_class_bullet"] == 0.0


def test_train_model_refuses_with_too_few_games(db_session, tmp_path):
    for i in range(5):
        _seed_game(db_session, i, strong=True)
    with pytest.raises(RuntimeError, match="Only 5"):
        train_model(db_session, _settings(tmp_path))


def test_train_and_predict_round_trip(db_session, tmp_path):
    n_games = MIN_TRAINING_GAMES + 5
    for i in range(n_games):
        _seed_game(db_session, i, strong=(i % 2 == 0))

    settings = _settings(tmp_path)
    X, y, game_ids = build_training_data(db_session)
    assert X.shape == (n_games, len(FEATURE_NAMES))
    assert len(y) == len(game_ids) == n_games

    result = train_model(db_session, settings)
    assert result.n_samples == n_games
    assert result.cv_mae >= 0
    assert result.cv_r2 <= 1.0

    # persisted under the tmp dir -- never the app's real data/ directory
    assert (tmp_path / "strength_model.joblib").exists()
    assert (tmp_path / "strength_model_meta.json").exists()

    loaded_meta = load_meta(settings)
    assert loaded_meta is not None
    assert loaded_meta.n_samples == n_games

    model = load_model(settings)
    assert model is not None

    predictions = predict_all(db_session, settings)
    assert len(predictions) == n_games
    for row in predictions:
        assert row["actual_rating"] in (1200, 2000)
        assert isinstance(row["predicted_rating"], float)
