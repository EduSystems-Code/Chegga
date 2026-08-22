"""Parses Chess.com's %clk PGN annotations (`{[%clk 0:04:59.9]}` after each
move) and the TimeControl header, so move-level clock time can be joined
against move-level engine analysis without a second data source.

Correspondence/daily time controls ("1/259200" -- one move per N seconds)
have no meaningful "seconds remaining" concept the way a live clock does,
so both functions return None for them rather than a nonsense number.
"""
import re

import chess.pgn

_CLK_RE = re.compile(r"\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]")


def parse_time_control_base_seconds(time_control: str) -> int | None:
    """"600" -> 600. "180+2" -> 180 (the increment is ignored -- base time is
    what "time pressure" is measured against). "1/259200" (correspondence) -> None."""
    if not time_control or "/" in time_control:
        return None
    base = time_control.split("+", 1)[0]
    try:
        return int(base)
    except ValueError:
        return None


def _clock_seconds_from_comment(comment: str) -> float | None:
    match = _CLK_RE.search(comment)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_clocks_by_ply(parsed_game: chess.pgn.Game) -> dict[int, float]:
    """Returns {ply: clock_seconds_remaining_after_this_move}, 1-indexed to
    match MoveAnalysis.ply. Walks the parsed game tree (each node's own
    .comment) rather than regex-scanning the raw PGN text, so ply numbers
    stay correctly aligned even if a comment is missing for some move (an
    aborted game, an export quirk) -- a missing comment just yields a
    missing dict entry at that ply instead of shifting every later one."""
    clocks: dict[int, float] = {}
    ply = 0
    for node in parsed_game.mainline():
        ply += 1
        seconds = _clock_seconds_from_comment(node.comment)
        if seconds is not None:
            clocks[ply] = seconds
    return clocks
