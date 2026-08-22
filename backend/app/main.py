import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 - registers every model on Base.metadata before create_all runs
from app.api.routes import analysis, games, health, sync
from app.db.base import Base
from app.db.session import engine

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Alembic owns schema changes going forward; this is a safety net so a
    # fresh clone works even before the first `alembic upgrade head`.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Chegga", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
app.include_router(games.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
