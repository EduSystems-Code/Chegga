"""Predicts a Chess.com rating from move-quality features of a single game,
trained on the user's own analyzed history -- "how strong does this game's
play actually look" as a companion to the rating chess.com assigned it.

Train/serve skew (the classic bug where training and prediction compute
features differently and quietly diverge) is avoided by routing both
through the same extract_features(); there is exactly one feature pipeline.

Ratings are not comparable across time controls -- a 1800 bullet player and
a 1800 rapid player are different strengths. time_class is one-hot encoded
so the model can separate them instead of averaging across incompatible
scales.

The persisted model is a plain joblib dump next to the SQLite DB. This is a
single-user local app: no model registry, no versioning beyond the
metadata JSON's trained_at, and no concurrent-writer concerns beyond what
the training endpoint's own single-flight status flag already provides.
"""
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis

logger = logging.getLogger(__name__)

MIN_OWN_MOVES = 5  # shorter games (aborts, early resigns) are too noisy a sample to featurize
MIN_TRAINING_GAMES = 20  # below this, cross-validated error is not a meaningful number

_TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"]

FEATURE_NAMES = [
    "avg_cp_loss",
    "blunder_rate",
    "mistake_rate",
    "inaccuracy_rate",
    "good_rate",
    "excellent_rate",
    "best_rate",
    "opening_avg_cp_loss",
    "middlegame_avg_cp_loss",
    "endgame_avg_cp_loss",
    "num_own_moves",
    "is_white",
    *[f"time_class_{tc}" for tc in _TIME_CLASSES],
]


@dataclass
class TrainResult:
    n_samples: int
    cv_folds: int
    cv_mae: float
    cv_r2: float
    trained_at: str


def _model_path(settings: Settings) -> Path:
    return Path(settings.strength_model_dir) / "strength_model.joblib"


def _meta_path(settings: Settings) -> Path:
    return Path(settings.strength_model_dir) / "strength_model_meta.json"


def extract_features(game: Game, own_moves: list[MoveAnalysis]) -> dict[str, float] | None:
    """own_moves must already be filtered to this game's user_color side.
    Returns None if there isn't enough signal to featurize (too short a game)."""
    n = len(own_moves)
    if n < MIN_OWN_MOVES:
        return None

    cp_losses = [m.centipawn_loss for m in own_moves]
    counts = {"blunder": 0, "mistake": 0, "inaccuracy": 0, "good": 0, "excellent": 0, "best": 0}
    for m in own_moves:
        counts[m.classification] = counts.get(m.classification, 0) + 1

    phase_losses: dict[str, list[int]] = {"opening": [], "middlegame": [], "endgame": []}
    for m in own_moves:
        if m.game_phase in phase_losses:
            phase_losses[m.game_phase].append(m.centipawn_loss)

    def phase_avg(phase: str) -> float:
        losses = phase_losses[phase]
        return sum(losses) / len(losses) if losses else 0.0

    features = {
        "avg_cp_loss": sum(cp_losses) / n,
        "blunder_rate": counts["blunder"] / n,
        "mistake_rate": counts["mistake"] / n,
        "inaccuracy_rate": counts["inaccuracy"] / n,
        "good_rate": counts["good"] / n,
        "excellent_rate": counts["excellent"] / n,
        "best_rate": counts["best"] / n,
        "opening_avg_cp_loss": phase_avg("opening"),
        "middlegame_avg_cp_loss": phase_avg("middlegame"),
        "endgame_avg_cp_loss": phase_avg("endgame"),
        "num_own_moves": float(n),
        "is_white": 1.0 if game.user_color == "white" else 0.0,
    }
    for tc in _TIME_CLASSES:
        features[f"time_class_{tc}"] = 1.0 if game.time_class == tc else 0.0

    return features


def _target_rating(game: Game) -> int:
    return game.white_rating if game.user_color == "white" else game.black_rating


def build_training_data(db: Session) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Returns (X, y, game_ids) over every analyzed game with enough own
    moves to featurize. game_ids lines up row-for-row with X/y so callers
    can join predictions back to their source game."""
    games = list(db.scalars(select(Game).where(Game.analyzed.is_(True))))

    rows: list[list[float]] = []
    targets: list[int] = []
    game_ids: list[int] = []

    for game in games:
        own_moves = list(
            db.scalars(
                select(MoveAnalysis).where(
                    MoveAnalysis.game_id == game.id, MoveAnalysis.side_to_move == game.user_color
                )
            )
        )
        features = extract_features(game, own_moves)
        if features is None:
            continue
        rows.append([features[name] for name in FEATURE_NAMES])
        targets.append(_target_rating(game))
        game_ids.append(game.id)

    return np.array(rows, dtype=float), np.array(targets, dtype=float), game_ids


def train_model(db: Session, settings: Settings) -> TrainResult:
    X, y, _ = build_training_data(db)
    n_samples = len(y)
    if n_samples < MIN_TRAINING_GAMES:
        raise RuntimeError(
            f"Only {n_samples} analyzed games have enough moves to train on "
            f"(need at least {MIN_TRAINING_GAMES}). Let the analysis backlog run longer."
        )

    # Small dataset: k-fold cross-validation gives an honest error estimate
    # instead of a single train/test split, which at this sample size would
    # swing wildly depending on which games happened to land in the test set.
    cv_folds = min(5, n_samples // 4)
    kfold = KFold(n_splits=cv_folds, shuffle=True, random_state=42)

    cv_model = RandomForestRegressor(n_estimators=200, random_state=42)
    predictions = cross_val_predict(cv_model, X, y, cv=kfold)
    cv_mae = float(np.mean(np.abs(predictions - y)))
    ss_res = float(np.sum((y - predictions) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    cv_r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Refit on the full dataset for the model that actually gets persisted
    # and used to predict -- cross-validation above is purely for reporting
    # an honest error estimate, never the model saved to disk.
    final_model = RandomForestRegressor(n_estimators=200, random_state=42)
    final_model.fit(X, y)

    model_path = _model_path(settings)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final_model, model_path)

    result = TrainResult(
        n_samples=n_samples,
        cv_folds=cv_folds,
        cv_mae=round(cv_mae, 1),
        cv_r2=round(cv_r2, 3),
        trained_at=datetime.utcnow().isoformat(),
    )
    _meta_path(settings).write_text(json.dumps(result.__dict__, indent=2))
    logger.info("Trained strength model: n=%d cv_mae=%.1f cv_r2=%.3f", n_samples, cv_mae, cv_r2)
    return result


def load_model(settings: Settings) -> RandomForestRegressor:
    model_path = _model_path(settings)
    if not model_path.exists():
        raise RuntimeError("No trained strength model yet -- run training first")
    return joblib.load(model_path)


def load_meta(settings: Settings) -> TrainResult | None:
    meta_path = _meta_path(settings)
    if not meta_path.exists():
        return None
    return TrainResult(**json.loads(meta_path.read_text()))


def predict_all(db: Session, settings: Settings) -> list[dict]:
    """Predicted vs. actual rating for every analyzed game, for the
    player-tracking chart -- how the gap between assigned rating and
    play-quality-implied rating moves over time."""
    model = load_model(settings)
    X, y, game_ids = build_training_data(db)
    if len(game_ids) == 0:
        return []
    predictions = model.predict(X)

    games_by_id = {g.id: g for g in db.scalars(select(Game).where(Game.id.in_(game_ids)))}
    out = []
    for game_id, actual, predicted in zip(game_ids, y, predictions):
        game = games_by_id[game_id]
        out.append(
            {
                "game_id": game_id,
                "end_time": game.end_time,
                "time_class": game.time_class,
                "actual_rating": int(actual),
                "predicted_rating": round(float(predicted), 1),
            }
        )
    out.sort(key=lambda r: r["end_time"])
    return out
