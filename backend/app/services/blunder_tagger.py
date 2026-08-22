"""Classifies WHY a mistake/blunder happened, not just how costly it was.
centipawn_loss + classification already say "this move lost ~150cp";
blunder_tag says "...because you hung your knight" -- the difference
between a stat and something a drill or a coaching report can act on.

Tags are mutually exclusive, checked in priority order (most diagnostic
first): a hung piece is a more useful lesson than "positional" even if a
position also happens to be slightly worse for other reasons.

This is deliberately NOT a full static-exchange evaluator -- "hanging"
below is an approximation (undefended, or defended only by pieces worth
more than a cheaper attacker) that catches the common, teachable cases
without another engine call per move.
"""
import chess

MISSED_MATE = "missed_mate"       # a forced mate was available and you didn't play it
ALLOWED_MATE = "allowed_mate"     # your move let the opponent force mate
HUNG_MATERIAL = "hung_material"   # a piece of yours is now capturable for less than it's worth
MISSED_CAPTURE = "missed_capture"  # the engine's best move was a capture and you played something else
POSITIONAL = "positional"          # none of the above -- lost eval without a clean material/tactical story

_PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,  # never actually hangs, but keeps the value lookup total
}

_TAGGABLE_CLASSIFICATIONS = {"mistake", "blunder"}


def _is_hanging(board: chess.Board, square: chess.Square, piece_color: bool) -> bool:
    piece = board.piece_at(square)
    if piece is None or piece.piece_type == chess.KING:
        return False
    attackers = board.attackers(not piece_color, square)
    if not attackers:
        return False
    defenders = board.attackers(piece_color, square)
    if not defenders:
        return True
    cheapest_attacker = min(_PIECE_VALUES[board.piece_at(sq).piece_type] for sq in attackers)
    return cheapest_attacker < _PIECE_VALUES[piece.piece_type]


def _has_hanging_piece(board: chess.Board, color: bool) -> bool:
    return any(
        _is_hanging(board, square, color)
        for square, piece in board.piece_map().items()
        if piece.color == color
    )


def tag_move(
    fen_before: str,
    uci: str,
    san: str,
    best_move_san: str | None,
    eval_before_mate: int | None,
    eval_after_mate: int | None,
    side_to_move: str,
    classification: str,
) -> str | None:
    if classification not in _TAGGABLE_CLASSIFICATIONS:
        return None

    mover_sign = 1 if side_to_move == "white" else -1
    best_before_mover_mate = eval_before_mate * mover_sign if eval_before_mate is not None else None
    after_mover_mate = eval_after_mate * mover_sign if eval_after_mate is not None else None

    if best_before_mover_mate is not None and best_before_mover_mate > 0:
        return MISSED_MATE
    if after_mover_mate is not None and after_mover_mate < 0:
        return ALLOWED_MATE

    board = chess.Board(fen_before)
    mover_color = board.turn
    board.push(chess.Move.from_uci(uci))
    if _has_hanging_piece(board, mover_color):
        return HUNG_MATERIAL

    if best_move_san and "x" in best_move_san and "x" not in san:
        return MISSED_CAPTURE

    return POSITIONAL
