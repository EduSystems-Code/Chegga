"""CLI entry point for (re-)training the strength/rating-prediction model.

    python -m app.scripts.train_strength_model

Re-run any time the analysis backlog has made progress -- "get better Elo
prediction" is this: more analyzed games in, a lower cross-validated MAE
out. The API route (POST /api/strength/train) runs the exact same
train_model() as a background task; this script is the same operation with
its result printed synchronously instead of polled.
"""
import logging

from app.config import get_settings
from app.db.session import SessionLocal
from app.services.strength_model import train_model

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main() -> None:
    db = SessionLocal()
    try:
        result = train_model(db, get_settings())
    finally:
        db.close()
    print(
        f"Trained on {result.n_samples} games ({result.cv_folds}-fold CV): "
        f"MAE={result.cv_mae} rating points, R²={result.cv_r2}"
    )


if __name__ == "__main__":
    main()
