"""Turns one raw Chess.com archive-game JSON object into Game model fields.

Chess.com's own JSON already carries almost everything (ratings, time
control, result codes, the PGN itself) -- this module's job is narrow:
collapse each side's result code to win/loss/draw, pull a readable opening
name out of the `eco` field, and figure out which color the tracked user
played.
"""
import re
from typing import Any

# Chess.com's per-side result code -> outcome. The LOSING side's code
# describes *how* they lost ("checkmated", "resigned", "timeout"), not a
# shared "loss" value, so both sides need this lookup independently.
# Unrecognized codes fall back to "draw" rather than raising -- a code
# chess.com adds later shouldn't break ingestion of everything after it.
_RESULT_TO_OUTCOME = {
    "win": "win",
    "checkmated": "loss",
    "agreed": "draw",
    "repetition": "draw",
    "timeout": "loss",
    "resigned": "loss",
    "stalemate": "draw",
    "lose": "loss",
    "insufficient": "draw",
    "50move": "draw",
    "abandoned": "loss",
    "kingofthehill": "loss",
    "threecheck": "loss",
    "timevsinsufficient": "draw",
    "bughousepartnerlose": "loss",
}


def result_to_outcome(result_code: str) -> str:
    return _RESULT_TO_OUTCOME.get(result_code, "draw")


def extract_opening_name(eco: str | None) -> str | None:
    """Chess.com's `eco` field is a URL into their openings pages (e.g.
    ".../openings/Italian-Game"); this is a best-effort readable name, not
    an authoritative ECO code lookup -- worth spot-checking against real
    synced data, since the exact field format wasn't verified against a
    live API response before this was written."""
    if not eco:
        return None
    slug = eco.rstrip("/").rsplit("/", 1)[-1]
    slug = re.sub(r"-\d+.*$", "", slug)  # drop trailing move/variation numbers
    name = slug.replace("-", " ").strip()
    return name or None


def normalize_game(raw: dict[str, Any], tracked_username: str) -> dict[str, Any]:
    white = raw["white"]
    black = raw["black"]
    tracked_lower = tracked_username.lower()

    if white["username"].lower() == tracked_lower:
        user_color = "white"
    elif black["username"].lower() == tracked_lower:
        user_color = "black"
    else:
        raise ValueError(f"Tracked user {tracked_username!r} not in game {raw.get('uuid')}")

    white_outcome = result_to_outcome(white["result"])
    black_outcome = result_to_outcome(black["result"])
    user_result = white_outcome if user_color == "white" else black_outcome

    return {
        "chess_com_uuid": raw["uuid"],
        "url": raw.get("url", ""),
        "pgn": raw.get("pgn", ""),
        "time_control": raw.get("time_control", ""),
        "time_class": raw.get("time_class", "unknown"),
        "rules": raw.get("rules", "chess"),
        "rated": bool(raw.get("rated", False)),
        "end_time": raw.get("end_time", 0),
        "eco": raw.get("eco"),
        "opening_name": extract_opening_name(raw.get("eco")),
        "white_username": white["username"],
        "white_rating": white.get("rating", 0),
        "black_username": black["username"],
        "black_rating": black.get("rating", 0),
        "white_result": white["result"],
        "black_result": black["result"],
        "user_color": user_color,
        "user_result": user_result,
    }
