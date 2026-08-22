import io

import chess.pgn

from app.services.clock_parser import parse_clocks_by_ply, parse_time_control_base_seconds

SAMPLE_PGN = """[Event "Live Chess"]
[White "MichaelBottega"]
[Black "opponent"]

1. d4 {[%clk 0:04:59.9]} 1... d5 {[%clk 0:04:58.2]} 2. c4 {[%clk 0:04:57.4]} 2... e6 {no clock here} 3. Nf3 {[%clk 0:04:50.1]} *
"""


def test_parse_time_control_base_seconds_plain():
    assert parse_time_control_base_seconds("600") == 600


def test_parse_time_control_base_seconds_with_increment_ignores_increment():
    assert parse_time_control_base_seconds("180+2") == 180


def test_parse_time_control_base_seconds_correspondence_returns_none():
    assert parse_time_control_base_seconds("1/259200") is None


def test_parse_time_control_base_seconds_empty_returns_none():
    assert parse_time_control_base_seconds("") is None


def test_parse_clocks_by_ply_reads_real_chess_com_annotations():
    game = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    clocks = parse_clocks_by_ply(game)

    assert clocks[1] == 4 * 60 + 59.9
    assert clocks[2] == 4 * 60 + 58.2
    assert clocks[3] == 4 * 60 + 57.4
    assert clocks[5] == 4 * 60 + 50.1


def test_parse_clocks_by_ply_missing_comment_does_not_shift_later_plies():
    # Ply 4 (2...e6) has no %clk comment and must simply be absent from the
    # dict -- not cause ply 5's clock to be misassigned to ply 4.
    game = chess.pgn.read_game(io.StringIO(SAMPLE_PGN))
    clocks = parse_clocks_by_ply(game)

    assert 4 not in clocks
    assert clocks[5] == 4 * 60 + 50.1
