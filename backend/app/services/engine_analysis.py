"""Walks stored games through Stockfish and records per-move analysis.

For a game with n plies this runs n+1 engine analyses (one per board
position, including the start and the final position) with MultiPV, not 2n.
eval_before for the move played at ply i comes from position i's top line;
eval_after comes from position i+1's top line -- the REAL resulting
position, not derived out of position i's MultiPV list, which would miss
the true eval whenever the played move falls outside the top-N candidates.

Analysis is currently supported for standard chess only. Chess960/variant
games are ingested in Phase 1 but skipped here -- a documented limitation,
not a guess at variant handling that was never actually exercised.
"""
import io
import logging
from datetime import datetime

import chess
import chess.engine
import chess.pgn
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.game import Game
from app.models.move_analysis import MoveAnalysis
from app.services.blunder_tagger import tag_move
from app.services.clock_parser import parse_clocks_by_ply
from app.services.time_pressure_service import band_for

logger = logging.getLogger(__name__)

MATE_SCORE_CP = 100_000
DISPLAY_CLAMP_CP = 1000  # caps mate-adjacent blowups so a single move can't dominate a chart

SUPPORTED_RULES = {"chess"}

# Our own explicit, tunable convention -- there is no industry-standard
# definition of these labels. Centipawn loss thresholds, mover's
# perspective, lowest to highest.
_CLASSIFICATION_THRESHOLDS = [
    (10, "best"),
    (25, "excellent"),
    (50, "good"),
    (100, "inaccuracy"),
    (200, "mistake"),
]
_BLUNDER = "blunder"


def classify(centipawn_loss: int) -> str:
    for threshold, label in _CLASSIFICATION_THRESHOLDS:
        if centipawn_loss <= threshold:
            return label
    return _BLUNDER


def game_phase(ply: int, board: chess.Board) -> str:
    if ply <= 20:
        return "opening"
    non_pawn_king_material = sum(
        len(board.pieces(piece_type, color))
        for color in (chess.WHITE, chess.BLACK)
        for piece_type in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
    )
    return "endgame" if non_pawn_king_material <= 6 else "middlegame"


def _white_relative_cp(score: chess.engine.PovScore) -> tuple[int | None, int | None]:
    white_score = score.white()
    return white_score.score(mate_score=MATE_SCORE_CP), white_score.mate()


def _as_sorted_lines(info: chess.engine.InfoDict | list[chess.engine.InfoDict]) -> list[chess.engine.InfoDict]:
    lines = info if isinstance(info, list) else [info]
    return sorted(lines, key=lambda line: line.get("multipv", 1))


def analyze_game(engine: chess.engine.SimpleEngine, game_row: Game, settings: Settings) -> list[MoveAnalysis]:
    parsed = chess.pgn.read_game(io.StringIO(game_row.pgn))
    if parsed is None:
        raise ValueError(f"Could not parse stored PGN for game {game_row.id}")

    moves = list(parsed.mainline_moves())
    clocks_by_ply = parse_clocks_by_ply(parsed)
    limit = chess.engine.Limit(depth=settings.stockfish_depth, time=settings.stockfish_movetime_ms / 1000)
    multipv = settings.stockfish_multipv

    board = parsed.board()
    boards_by_ply = [board.copy()]
    positions_info = [_as_sorted_lines(engine.analyse(board, limit, multipv=multipv))]
    for move in moves:
        board.push(move)
        positions_info.append(_as_sorted_lines(engine.analyse(board, limit, multipv=multipv)))
        boards_by_ply.append(board.copy())

    results: list[MoveAnalysis] = []
    for i, move in enumerate(moves):
        board_before = boards_by_ply[i]
        mover_sign = 1 if board_before.turn == chess.WHITE else -1

        lines_before = positions_info[i]
        best_line = lines_before[0]
        best_cp_white, best_mate_white = _white_relative_cp(best_line["score"])

        after_cp_white, after_mate_white = _white_relative_cp(positions_info[i + 1][0]["score"])

        best_before_mover = (best_cp_white or 0) * mover_sign
        actual_after_mover = (after_cp_white or 0) * mover_sign
        centipawn_loss = min(max(0, best_before_mover - actual_after_mover), DISPLAY_CLAMP_CP)

        move_rank = next(
            (line.get("multipv", 1) for line in lines_before if line.get("pv") and line["pv"][0] == move),
            None,
        )
        best_move = best_line.get("pv", [None])[0]

        ply = i + 1
        side_to_move = "white" if board_before.turn == chess.WHITE else "black"
        san = board_before.san(move)
        best_move_san = board_before.san(best_move) if best_move else None
        classification = classify(centipawn_loss)
        clock_seconds = clocks_by_ply.get(ply)

        results.append(
            MoveAnalysis(
                game_id=game_row.id,
                ply=ply,
                side_to_move=side_to_move,
                fen_before=board_before.fen(),
                san=san,
                uci=move.uci(),
                eval_before_cp=best_cp_white,
                eval_before_mate=best_mate_white,
                eval_after_cp=after_cp_white,
                eval_after_mate=after_mate_white,
                best_move_uci=best_move.uci() if best_move else None,
                best_move_san=best_move_san,
                centipawn_loss=centipawn_loss,
                move_rank=move_rank,
                classification=classification,
                game_phase=game_phase(ply, board_before),
                blunder_tag=tag_move(
                    fen_before=board_before.fen(),
                    uci=move.uci(),
                    san=san,
                    best_move_san=best_move_san,
                    eval_before_mate=best_mate_white,
                    eval_after_mate=after_mate_white,
                    side_to_move=side_to_move,
                    classification=classification,
                ),
                clock_seconds=clock_seconds,
                time_pressure_band=band_for(clock_seconds, game_row.time_control),
            )
        )

    return results


def analyze_pending_games(db: Session, settings: Settings, limit: int | None = None) -> int:
    if not settings.stockfish_path:
        raise RuntimeError("STOCKFISH_PATH is not set -- fill it in in backend/.env first")

    stmt = (
        select(Game)
        .where(Game.analyzed.is_(False), Game.rules.in_(SUPPORTED_RULES))
        .order_by(Game.end_time.desc())  # newest first: useful data fast, older history backfills over time
    )
    if limit:
        stmt = stmt.limit(limit)
    pending = list(db.scalars(stmt))

    if not pending:
        logger.info("No pending games to analyze")
        return 0

    # One long-lived engine process reused across the whole batch --
    # Stockfish's startup cost makes per-game spawning wasteful.
    engine = chess.engine.SimpleEngine.popen_uci(settings.stockfish_path)
    try:
        engine.configure({"Threads": settings.stockfish_threads})
        analyzed_count = 0
        for game_row in pending:
            try:
                move_rows = analyze_game(engine, game_row, settings)
            except Exception:
                logger.exception("Failed to analyze game %s (%s)", game_row.id, game_row.chess_com_uuid)
                db.rollback()
                continue

            for row in move_rows:
                db.add(row)
            game_row.analyzed = True
            game_row.analyzed_at = datetime.utcnow()
            db.commit()  # transactional per game -- a crash mid-game must never leave it falsely marked done
            analyzed_count += 1
            logger.info("Analyzed game %s: %d moves", game_row.chess_com_uuid, len(move_rows))
        return analyzed_count
    finally:
        engine.quit()
