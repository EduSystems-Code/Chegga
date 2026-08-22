// Renders a position and, when interactive, accepts answers by dragging a
// piece rather than picking from a button list -- chess.js owns legality
// (which squares a drag may land on) and produces the resulting move's SAN,
// which is all the backend needs to grade an attempt the same way it always
// did. Read-only mode (interactive=false, the default) just renders board().
import { useEffect, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";

const UNICODE_PIECES: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const PROMOTION_CHOICES = [
  { piece: "q" as const, glyph: "♛" },
  { piece: "r" as const, glyph: "♜" },
  { piece: "b" as const, glyph: "♝" },
  { piece: "n" as const, glyph: "♞" },
];

function squareAt(rankIdx: number, fileIdx: number): Square {
  // board()[0] is rank 8 (top row for White's-eye view); fileIdx 0 is the a-file.
  const rank = 8 - rankIdx;
  return `${FILES[fileIdx]}${rank}` as Square;
}

interface BoardProps {
  fen: string;
  interactive?: boolean;
  onMove?: (san: string) => void;
}

export default function Board({ fen, interactive = false, onMove }: BoardProps) {
  const chessRef = useRef(new Chess(fen));
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);

  const [dragFrom, setDragFrom] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  // A new drill (new fen) means a fresh position -- reset the chess.js
  // instance and any in-flight drag/promotion state from the last one.
  useEffect(() => {
    chessRef.current = new Chess(fen);
    setDragFrom(null);
    setLegalTargets([]);
    setPendingPromotion(null);
    rerender();
  }, [fen]);

  const chess = chessRef.current;
  const rows = chess.board();

  const clearDrag = () => {
    setDragFrom(null);
    setLegalTargets([]);
  };

  const handleDragStart = (square: Square) => {
    if (!interactive) return;
    const piece = chess.get(square);
    if (!piece || piece.color !== chess.turn()) return; // only the side to move's own pieces are draggable
    setDragFrom(square);
    setLegalTargets(chess.moves({ square, verbose: true }).map((m) => m.to as Square));
  };

  const handleDrop = (to: Square) => {
    if (!interactive || !dragFrom || !legalTargets.includes(to)) {
      clearDrag();
      return;
    }
    const from = dragFrom;
    const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    clearDrag();

    if (candidates.length > 1) {
      // Same from/to with more than one legal move only happens when a pawn
      // reaches the last rank and can promote to more than one piece.
      setPendingPromotion({ from, to });
      return;
    }
    const result = chess.move({ from, to });
    rerender();
    if (result) onMove?.(result.san);
  };

  const finishPromotion = (promotion: "q" | "r" | "b" | "n") => {
    if (!pendingPromotion) return;
    const result = chess.move({ ...pendingPromotion, promotion });
    setPendingPromotion(null);
    rerender();
    if (result) onMove?.(result.san);
  };

  return (
    <div className="board-wrap">
      <div className="board">
        {rows.map((row, rankIdx) => (
          <div className="board-row" key={rankIdx}>
            {row.map((piece, fileIdx) => {
              const light = (rankIdx + fileIdx) % 2 === 0; // a1 is dark -- this parity matches that
              const square = squareAt(rankIdx, fileIdx);
              const isLegalTarget = legalTargets.includes(square);
              const draggable = interactive && !!piece && piece.color === chess.turn();
              return (
                <div
                  key={fileIdx}
                  data-square={square}
                  className={[
                    "board-square",
                    light ? "light" : "dark",
                    isLegalTarget ? "legal-target" : "",
                    dragFrom === square ? "drag-source" : "",
                  ].filter(Boolean).join(" ")}
                  onDragOver={(e) => { if (isLegalTarget) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(square); }}
                >
                  {piece && (
                    <span
                      className={`board-piece ${piece.color === "w" ? "piece-white" : "piece-black"} ${draggable ? "draggable" : ""}`}
                      draggable={draggable}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", square); handleDragStart(square); }}
                      onDragEnd={clearDrag}
                    >
                      {UNICODE_PIECES[piece.color === "w" ? piece.type.toUpperCase() : piece.type]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {pendingPromotion && (
        <div className="promotion-picker">
          <span>Promote to</span>
          {PROMOTION_CHOICES.map(({ piece, glyph }) => (
            <button key={piece} onClick={() => finishPromotion(piece)}>{glyph}</button>
          ))}
        </div>
      )}
    </div>
  );
}
