// Chegga Web — chess-rules cheat sheet.
//
// Content scope (how pieces move, setup, check, ending the game, castling,
// en passant/promotion, basic strategy, common tactics) mirrors what any
// chess-rules reference covers -- the rules of chess aren't anyone's
// property. The words, layout, and piece rendering below are original to
// this project: no imported text, no Chess.com branding/colors/logo, and
// no reproduced piece-set art. Pieces are the standard Unicode chess
// glyphs (U+2654-265F) -- public-domain text characters, not an image
// asset -- styled in Chegga's own palette instead of copying anyone's
// board skin. See Chegga's context.md: "Chess piece/board art is
// original, not reproduced" is a standing, deliberate rule for this
// whole project, not just the drill board.

const PIECE_GLYPH: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", // white (outline)
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟", // black (filled)
};

/** Renders a small 8x8 board. `pieces` maps "e4"-style square names to a
 * piece letter (K/Q/R/B/N/P white, lowercase black). `highlights` marks
 * squares to tint — move destinations, the square a piece just left, etc. */
function miniBoard(opts: {
  pieces?: Record<string, string>;
  highlights?: string[];
}): string {
  const pieces = opts.pieces ?? {};
  const highlights = new Set(opts.highlights ?? []);
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

  let cells = "";
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const name = files[file] + (rank + 1);
      const isLight = (file + rank) % 2 === 1;
      const piece = pieces[name];
      const hi = highlights.has(name);
      cells += `<div class="cs-sq ${isLight ? "cs-light" : "cs-dark"} ${hi ? "cs-hi" : ""}">
        ${piece ? `<span class="cs-piece">${PIECE_GLYPH[piece] ?? ""}</span>` : ""}
      </div>`;
    }
  }
  return `<div class="cs-board">${cells}</div>`;
}

function startingPositionPieces(): Record<string, string> {
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const p: Record<string, string> = {};
  files.forEach((f, i) => {
    p[f + "1"] = back[i];
    p[f + "2"] = "P";
    p[f + "8"] = back[i].toLowerCase();
    p[f + "7"] = "p";
  });
  return p;
}

function section(id: string, title: string, body: string): string {
  return `<div class="cs-section" id="${id}"><h3 class="cs-h3">${title}</h3>${body}</div>`;
}

export function renderCheatSheet(): string {
  const pawnBoard = miniBoard({
    pieces: { d2: "P", e4: "p" },
    highlights: ["d3", "d4"],
  });
  const knightBoard = miniBoard({
    pieces: { d4: "N" },
    highlights: ["c6", "e6", "b5", "f5", "b3", "f3", "c2", "e2"],
  });
  const bishopBoard = miniBoard({
    pieces: { d4: "B" },
    highlights: ["a1", "b2", "c3", "e5", "f6", "g7", "h8", "a7", "b6", "c5", "e3", "f2", "g1"],
  });
  const rookBoard = miniBoard({
    pieces: { d4: "R" },
    highlights: ["d1", "d2", "d3", "d5", "d6", "d7", "d8", "a4", "b4", "c4", "e4", "f4", "g4", "h4"],
  });
  const queenBoard = miniBoard({
    pieces: { d4: "Q" },
    highlights: [
      "d1", "d2", "d3", "d5", "d6", "d7", "d8", "a4", "b4", "c4", "e4", "f4", "g4", "h4",
      "a1", "b2", "c3", "e5", "f6", "g7", "h8", "a7", "b6", "c5", "e3", "f2", "g1",
    ],
  });
  const kingBoard = miniBoard({
    pieces: { d4: "K" },
    highlights: ["c3", "d3", "e3", "c4", "e4", "c5", "d5", "e5"],
  });

  const setup = miniBoard({ pieces: startingPositionPieces() });

  const castleKingsidePieces = startingPositionPieces();
  delete castleKingsidePieces.e1;
  delete castleKingsidePieces.h1;
  castleKingsidePieces.f1 = "R";
  castleKingsidePieces.g1 = "K";
  const castleKingside = miniBoard({ pieces: castleKingsidePieces, highlights: ["f1", "g1"] });

  return `
    <div class="cs-wrap">
      <p class="cs-intro">
        Every rule of chess in one place, written for Chegga rather than copied from anywhere —
        pieces below are the standard chess symbols, not any site's board art.
      </p>

      ${section(
        "cs-setup",
        "Setting up the board",
        `<p>However the board is turned, the square closest to each player's right hand is always light.
        Pawns fill the second row on each side. Rooks take the corners. Knights sit next to the rooks,
        bishops next to the knights. Each queen goes on the square matching her own color — the white
        queen on a light square, the black queen on a dark one — and the king takes whichever square is left.</p>
        <div class="cs-board-row">${setup}</div>`
      )}

      ${section(
        "cs-moves",
        "How each piece moves",
        `<div class="cs-piece-grid">
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.P}</span> Pawn</div>
            ${pawnBoard}
            <p>Moves straight ahead one square — two on its very first move — but can only capture one
            square diagonally forward. It never moves or captures backward.</p>
          </div>
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.N}</span> Knight</div>
            ${knightBoard}
            <p>Moves in an L: two squares one direction, then one square perpendicular. The only piece
            that can jump clean over anything in its way.</p>
          </div>
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.B}</span> Bishop</div>
            ${bishopBoard}
            <p>Slides diagonally, any distance, as far as the board or another piece allows. A bishop
            starting on a light square stays on light squares forever, and the same for dark.</p>
          </div>
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.R}</span> Rook</div>
            ${rookBoard}
            <p>Slides in a straight line — up, down, left, right — any distance, until it hits the edge
            of the board or another piece.</p>
          </div>
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.Q}</span> Queen</div>
            ${queenBoard}
            <p>Combines the rook and the bishop — any straight line or diagonal, any distance. The most
            mobile piece on the board.</p>
          </div>
          <div class="cs-piece-item">
            <div class="cs-piece-item-head"><span class="cs-piece">${PIECE_GLYPH.K}</span> King</div>
            ${kingBoard}
            <p>Moves exactly one square, any direction. Slow, but it's the piece the entire game revolves
            around protecting.</p>
          </div>
        </div>`
      )}

      ${section(
        "cs-playing",
        "Playing a game",
        `<p><strong>White always moves first.</strong> After that, players alternate one move at a time —
        there's no skipping a turn. Moving onto a square held by an enemy piece captures it and removes
        it from the board; you can never move onto or through a square held by your own piece.</p>
        <p>Most games are played with a clock. Each side gets a set amount of time for the whole game
        (sometimes with a few seconds added back after every move); running out of time loses the game
        outright, even with a completely winning position on the board.</p>`
      )}

      ${section(
        "cs-check",
        "Check",
        `<p>A king under direct attack is "in check" — a warning, not the end of the game. A player in
        check must immediately do one of three things:</p>
        <ol class="cs-list">
          <li>Move the king to a safe square.</li>
          <li>Block the attack by putting another piece in the way.</li>
          <li>Capture the piece giving check.</li>
        </ol>
        <p>A king can never simply be captured, and a player can never make a move that leaves their own
        king in check.</p>`
      )}

      ${section(
        "cs-castling",
        "Castling",
        `<p>Castling is the one move that repositions two pieces at once, and the only time a king ever
        moves more than one square. The king moves two squares toward a rook, and that rook jumps to the
        square right next to the king on the other side.</p>
        <div class="cs-board-row">
          ${castleKingside}
          <p class="cs-board-caption">Kingside castling, White: the king goes from e1 to g1, the rook
          from h1 to f1. Queenside works the same toward the other rook, with the king landing on c1.</p>
        </div>
        <p>Castling has real conditions — all of them have to hold:</p>
        <ol class="cs-list">
          <li>Neither the king nor that particular rook has moved yet this game.</li>
          <li>No piece — friend or enemy — sits between the king and that rook.</li>
          <li>The king isn't currently in check.</li>
          <li>The king doesn't pass through a square that's under attack.</li>
          <li>The king doesn't land on a square that's under attack.</li>
        </ol>
        <p>The rook itself is allowed to pass through or start on an attacked square — only the king's
        own path and landing square matter.</p>`
      )}

      ${section(
        "cs-pawn-special",
        "Two pawn-only moves",
        `<p><strong>En passant</strong> ("in passing") is a capture that only exists for one move. If an
        enemy pawn uses its two-square opening move to land right beside one of your pawns, you may
        capture it immediately, as if it had only moved one square — but only on your very next move; the
        chance disappears after that.</p>
        <p><strong>Promotion</strong> happens the moment a pawn reaches the far end of the board. It's
        immediately traded for a queen, rook, bishop, or knight of the same color — there's no cap on how
        many of a piece you can have this way, so a second (or third) queen is completely legal.
        Promoting to anything other than a queen ("underpromotion") is rare, but occasionally the right
        call — a knight sometimes delivers checkmate a queen can't, and a rook or bishop can avoid handing
        the opponent a stalemate.</p>`
      )}

      ${section(
        "cs-ending",
        "How a game ends",
        `<p>Three ways to actually win:</p>
        <ol class="cs-list">
          <li><strong>Checkmate</strong> — the king is in check with no legal way out.</li>
          <li><strong>Resignation</strong> — the opponent gives up.</li>
          <li><strong>Time forfeit</strong> — the opponent's clock runs out.</li>
        </ol>
        <p>And several ways a game draws instead:</p>
        <ul class="cs-list">
          <li><strong>Stalemate</strong> — the player to move has no legal move at all, and isn't in check.</li>
          <li><strong>Threefold repetition</strong> — the identical position, with the identical player
          to move, occurs three separate times (not necessarily in a row).</li>
          <li><strong>Insufficient material</strong> — neither side has enough force left to force
          checkmate even in theory (king vs. king, for instance).</li>
          <li><strong>The 50-move rule</strong> — 50 moves pass, by both players, with no pawn move and
          no capture.</li>
          <li><strong>Agreement</strong> — both players simply agree to a draw.</li>
        </ul>`
      )}

      ${section(
        "cs-strategy",
        "Four ideas worth knowing early",
        `<div class="cs-idea-grid">
          <div class="cs-idea">
            <h4>Develop your pieces</h4>
            <p>Get knights and bishops off the back row before anything else. Moving the same piece
            twice in the opening, or pushing pawn after pawn while your pieces sit idle, gives your
            opponent free tempo.</p>
          </div>
          <div class="cs-idea">
            <h4>Fight for the center</h4>
            <p>The four central squares see more of the board than any others. Whoever controls them
            has more squares to maneuver into and more threats available at once.</p>
          </div>
          <div class="cs-idea">
            <h4>Get your king to safety</h4>
            <p>Losing on the board is losing, no matter how much material you're up. Castling early
            tucks the king behind a wall of pawns and gets a rook toward the action in the same move.</p>
          </div>
          <div class="cs-idea">
            <h4>Know what each piece is worth</h4>
            <p>Pawn 1, knight 3, bishop 3, rook 5, queen 9 — a rough guide for deciding whether a trade
            is worth it, not a literal win condition. Checkmate ends the game, not a points total.</p>
          </div>
        </div>`
      )}

      ${section(
        "cs-tactics",
        "Four common tactics",
        `<div class="cs-idea-grid">
          <div class="cs-idea">
            <h4>Pin</h4>
            <p>Attacking a piece that can't safely move, because a more valuable piece (often the king)
            sits directly behind it on the same line.</p>
          </div>
          <div class="cs-idea">
            <h4>Skewer</h4>
            <p>A pin in reverse — the more valuable piece is attacked first, and moving it out of the
            way exposes a weaker piece behind it to capture.</p>
          </div>
          <div class="cs-idea">
            <h4>Fork</h4>
            <p>One piece attacking two or more targets at once, with no way to save them both. Knights
            are especially dangerous here, since their L-shaped attack is hard to see coming.</p>
          </div>
          <div class="cs-idea">
            <h4>Discovered attack</h4>
            <p>Moving one piece out of the way reveals an attack from a completely different piece
            behind it. If the newly-revealed attack hits the enemy king, it's a discovered check.</p>
          </div>
        </div>`
      )}
    </div>
  `;
}
