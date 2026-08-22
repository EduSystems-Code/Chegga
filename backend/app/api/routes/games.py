from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models.game import Game
from app.schemas.game import GameDetail, GameSummary

router = APIRouter()


@router.get("/games", response_model=list[GameSummary])
def list_games(
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[Game]:
    stmt = select(Game).order_by(desc(Game.end_time)).limit(limit).offset(offset)
    return list(db.scalars(stmt))


@router.get("/games/{game_id}", response_model=GameDetail)
def get_game(game_id: int, db: Session = Depends(get_db)) -> Game:
    game = db.get(Game, game_id)
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return game
