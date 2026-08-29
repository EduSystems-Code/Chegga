"""A deliberately serial client for Chess.com's official Published-Data API.

Chess.com's rules (confirmed against their PubAPI FAQ and ToS forum post
before this was written): only the official read-only `api.chess.com/pub/...`
endpoints are used -- never the HTML site, which their ToS explicitly bans
scraping. Serial requests are unlimited; bursts of parallel requests can
trigger 429s. This client enforces a minimum spacing between requests itself
so nothing built on top of it can ever accidentally issue them in parallel --
it's a synchronous `requests.Session`, not an async client, by construction.
"""
import logging
import time
from typing import Any

import requests

logger = logging.getLogger(__name__)

CHESS_COM_API_BASE = "https://api.chess.com/pub"


class ChessComClient:
    def __init__(
        self,
        contact: str,
        min_interval_seconds: float = 1.0,
        max_retries: int = 5,
        timeout_seconds: float = 30.0,
    ):
        self.contact = contact
        self.min_interval_seconds = min_interval_seconds
        self.max_retries = max_retries
        self.timeout_seconds = timeout_seconds
        self._last_request_at: float = 0.0
        self._session = requests.Session()
        self._session.headers["User-Agent"] = f"Chegga/0.1 (personal chess analysis tool; contact: {contact})"

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        wait = self.min_interval_seconds - elapsed
        if wait > 0:
            time.sleep(wait)

    def _get(self, url: str) -> dict[str, Any]:
        for attempt in range(1, self.max_retries + 1):
            self._throttle()
            response = self._session.get(url, timeout=self.timeout_seconds)
            self._last_request_at = time.monotonic()

            if response.status_code == 200:
                return response.json()

            if response.status_code == 429 or response.status_code >= 500:
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else min(2**attempt, 60)
                logger.warning(
                    "Chess.com API %s on %s (attempt %d/%d) -- backing off %.1fs",
                    response.status_code,
                    url,
                    attempt,
                    self.max_retries,
                    delay,
                )
                time.sleep(delay)
                continue

            response.raise_for_status()

        raise RuntimeError(f"Chess.com API request failed after {self.max_retries} retries: {url}")

    def get_archive_urls(self, username: str) -> list[str]:
        data = self._get(f"{CHESS_COM_API_BASE}/player/{username}/games/archives")
        return data.get("archives", [])

    def get_archive(self, archive_url: str) -> list[dict[str, Any]]:
        data = self._get(archive_url)
        return data.get("games", [])
