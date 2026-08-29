from app.services.blunder_tagger import (
    ALLOWED_MATE,
    HUNG_MATERIAL,
    MISSED_CAPTURE,
    MISSED_MATE,
    POSITIONAL,
    tag_move,
)

# White queen d1, black king e8 + knight c6, white king e1. Qd1-d4?? walks
# into the knight's attack (Nc6 covers d4) with no white defender -- a
# verified hanging queen, not asserted by eye. Qd1-a4 is the same position's
# safe alternative (a4 is unattacked) for the non-hanging fixtures below.
FEN = "4k3/8/2n5/8/8/8/8/3QK3 w - - 0 1"
HANGING_UCI = "d1d4"
SAFE_UCI = "d1a4"


def _tag(**overrides):
    defaults = dict(
        fen_before=FEN,
        uci=SAFE_UCI,
        san="Qa4",
        best_move_san="Qb3",
        eval_before_mate=None,
        eval_after_mate=None,
        side_to_move="white",
        classification="mistake",
    )
    defaults.update(overrides)
    return tag_move(**defaults)


def test_returns_none_for_non_mistake_classifications():
    assert _tag(classification="best") is None
    assert _tag(classification="excellent") is None
    assert _tag(classification="good") is None
    assert _tag(classification="inaccuracy") is None


def test_missed_mate_when_mover_had_forced_mate():
    # White-relative +3 with white to move = mate FOR the mover, unplayed.
    assert _tag(eval_before_mate=3, classification="blunder") == MISSED_MATE


def test_missed_mate_respects_mover_color():
    # Same White-relative sign, but black to move -- mate was for white
    # (the opponent), not a missed mate for the mover.
    result = _tag(eval_before_mate=3, side_to_move="black", classification="blunder")
    assert result != MISSED_MATE


def test_allowed_mate_when_move_lets_opponent_force_mate():
    assert _tag(eval_after_mate=-2, classification="blunder") == ALLOWED_MATE


def test_hung_material_detects_a_verified_hanging_queen():
    assert _tag(uci=HANGING_UCI, san="Qd4", classification="blunder") == HUNG_MATERIAL


def test_missed_capture_when_best_move_captures_and_played_move_does_not():
    assert _tag(best_move_san="Qxc6", classification="mistake") == MISSED_CAPTURE


def test_positional_fallback_when_nothing_else_matches():
    assert _tag(best_move_san="Qb3", classification="mistake") == POSITIONAL


def test_priority_order_mate_beats_hanging_piece():
    # Even though d1d4 also hangs the queen, a missed mate is the more
    # diagnostic (and correct) explanation and must win.
    result = _tag(uci=HANGING_UCI, san="Qd4", eval_before_mate=1, classification="blunder")
    assert result == MISSED_MATE
