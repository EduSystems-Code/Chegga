// A read-only FEN renderer -- drills only need to display a position, never
// accept board input (answers are multiple-choice SAN buttons), so this
// stays plain CSS + unicode glyphs rather than pulling in a board library.
const UNICODE_PIECES: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

function parseFenBoard(fen: string): (string | null)[][] {
  const placement = fen.split(" ")[0];
  // FEN ranks run 8 -> 1 top to bottom, which is exactly a white-oriented
  // board's row order -- no flip needed for the default orientation this
  // renders in.
  return placement.split("/").map((rank) => {
    const squares: (string | null)[] = [];
    for (const char of rank) {
      if (/\d/.test(char)) {
        squares.push(...Array(Number(char)).fill(null));
      } else {
        squares.push(char);
      }
    }
    return squares;
  });
}

export default function Board({ fen }: { fen: string }) {
  const rows = parseFenBoard(fen);
  return (
    <div className="board">
      {rows.map((row, rankIdx) => (
        <div className="board-row" key={rankIdx}>
          {row.map((piece, fileIdx) => {
            const light = (rankIdx + fileIdx) % 2 === 0; // a1 is dark -- this parity matches that
            // Unicode chess glyphs are outline vs. filled shapes, not
            // inherently colored -- both sets otherwise render in the same
            // inherited text color and become indistinguishable on a dark
            // board. Color explicitly by case instead.
            const isWhitePiece = piece !== null && piece === piece.toUpperCase();
            return (
              <div key={fileIdx} className={`board-square ${light ? "light" : "dark"}`}>
                {piece && (
                  <span className={`board-piece ${isWhitePiece ? "piece-white" : "piece-black"}`}>
                    {UNICODE_PIECES[piece]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
