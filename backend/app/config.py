"""All tunables and secrets live here, read from backend/.env -- nothing
chess.com-, Stockfish-, or Claude-specific is hardcoded anywhere else.

chess_com_username/contact and stockfish_path are optional at startup
(rather than required, Pydantic-validated-on-boot fields) so the app can
come up and pass a health check before you've decided your Stockfish path
or filled in every field -- each feature that actually needs one of these
checks for it at the point of use and fails with a clear, specific message
instead of the whole app refusing to start.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    chess_com_username: str | None = None
    chess_com_contact: str | None = None

    stockfish_path: str | None = None
    stockfish_depth: int = 14
    stockfish_movetime_ms: int = 300
    stockfish_multipv: int = 3
    stockfish_threads: int = 2

    anthropic_api_key: str | None = None

    database_url: str = "sqlite:///./data/chegga.db"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
