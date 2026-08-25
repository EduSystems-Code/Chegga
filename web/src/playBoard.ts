// Chegga Web — interactive play board (drag-and-drop + click-to-move)
//
// A self-contained board widget: owns its own chess.js game state and
// DOM, exposes callbacks for "the player just made a legal move" and
// renders itself on every state change. Supports both chess.com-style
// drag-and-drop (grab a piece, it follows the cursor, drop on a
// highlighted legal square, illegal drops snap back) and the original
// click-to-select-then-click-to-move flow -- built on the Pointer Events
// API so the exact same code handles mouse and touch, rather than two
// separate implementations. Visual language matches openingBoard.ts
// (same square colors, same Unicode piece glyphs) so this reads as part
// of the same product, not a bolted-on widget.
//
// Also carries: a live-analysis overlay (best-move arrow + square-control
// heatmap, both purely presentational -- the actual eval numbers live in
// analysisPanel.ts, which drives this board's `showArrow`/`setHeatmapMode`
// rather than this file knowing anything about the engine), and a
// swappable color theme via CSS custom properties so every PlayBoard
// instance on the page reskins together.

import { Chess, type Square } from "chess.js";

const SELECTED_COLOR = "#3a4a2e";
const LAST_MOVE_COLOR = "rgba(227, 168, 87, 0.18)";
const CHECK_COLOR = "rgba(242, 85, 90, 0.35)";
const DRAG_HOVER_COLOR = "rgba(227, 168, 87, 0.30)";
const DRAG_START_PX = 4; // movement threshold before a pointerdown counts as a drag, not a tap

const PIECE_GLYPH: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

export type GameStatus =
  | { over: false; inCheck: boolean }
  | { over: true; result: "checkmate"; winner: "white" | "black" }
  | { over: true; result: "stalemate" | "draw" };

export type HeatmapMode = "off" | "control";

interface DragState {
  fromSquare: Square;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  ghostEl: HTMLElement | null;
  hoveredSquareEl: HTMLElement | null;
}

export class PlayBoard {
  private chess = new Chess();
  private startFen = new Chess().fen();
  private container: HTMLElement;
  private orientation: "white" | "black" = "white";
  private selected: Square | null = null;
  private lastMove: { from: Square; to: Square } | null = null;
  private locked = false; // true while it's not the human's turn to move
  private onPlayerMove: (uci: string, san: string) => void;
  private pendingPromotion: { from: Square; to: Square } | null = null;
  private drag: DragState | null = null;
  private arrow: { from: Square; to: Square } | null = null;
  private heatmapMode: HeatmapMode = "off";
  // Browsers fire a synthetic `click` right after `pointerup` even when
  // the pointerdown->pointerup pair was a real drag, not a tap -- this
  // suppresses that one click so a completed drag doesn't also run the
  // tap-to-move logic a second time on whatever square is now under the
  // cursor.
  private suppressNextClick = false;

  private handlePointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private handlePointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private handlePointerUp = (e: PointerEvent) => this.onPointerUp(e);
  private handleContainerClick = (e: MouseEvent) => this.onContainerClick(e);

  constructor(container: HTMLElement, onPlayerMove: (uci: string, san: string) => void) {
    this.container = container;
    this.onPlayerMove = onPlayerMove;
    this.container.addEventListener("pointerdown", this.handlePointerDown);
    // Promotion-picker buttons and the "tap, no drag" path are plain
    // clicks -- pointerdown/up already handle drags, this catches taps.
    this.container.addEventListener("click", this.handleContainerClick);
    this.render();
  }

  /** `fen` defaults to the standard start. Locked state is derived from
   * comparing the position's actual side-to-move against `orientation` —
   * not a hardcoded "if Black, wait for White" assumption — so this works
   * equally for a normal game, a puzzle position, an endgame drill, or a
   * "recover from here" position where the human might not be the side
   * who moves first. */
  reset(orientation: "white" | "black", fen?: string): void {
    this.chess = fen ? new Chess(fen) : new Chess();
    this.startFen = this.chess.fen();
    this.orientation = orientation;
    this.selected = null;
    this.lastMove = null;
    this.pendingPromotion = null;
    this.drag = null;
    this.arrow = null;
    const sideToMove = this.chess.turn() === "w" ? "white" : "black";
    this.locked = sideToMove !== orientation;
    this.render();
  }

  /** Like `reset`, but from a full PGN rather than just a FEN — preserves
   * move history (`getSanHistory`/`getPgn` reflect every move, not just
   * the position resumed into), for resuming a saved in-progress game. */
  loadFromPgn(orientation: "white" | "black", pgn: string): void {
    this.chess = new Chess();
    this.chess.loadPgn(pgn);
    this.startFen = this.chess.getHeaders().FEN ?? new Chess().fen();
    this.orientation = orientation;
    this.selected = null;
    this.pendingPromotion = null;
    this.drag = null;
    this.arrow = null;
    const history = this.chess.history({ verbose: true });
    const last = history[history.length - 1];
    this.lastMove = last ? { from: last.from, to: last.to } : null;
    const sideToMove = this.chess.turn() === "w" ? "white" : "black";
    this.locked = sideToMove !== orientation;
    this.render();
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.render();
  }

  getFen(): string {
    return this.chess.fen();
  }

  getStartFen(): string {
    return this.startFen;
  }

  getSanHistory(): string[] {
    return this.chess.history();
  }

  getPgn(): string {
    return this.chess.pgn();
  }

  /** Applies a move already decided elsewhere (the bot's move) to the
   * board and re-renders. */
  applyMove(uci: string): void {
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = uci.slice(4) || undefined;
    this.chess.move({ from, to, promotion });
    this.lastMove = { from, to };
    this.render();
  }

  /** Undoes the last `count` half-moves (default 2: the human's move and
   * the bot's reply, so it's the human's turn again after an undo). A
   * count larger than the actual history just undoes everything
   * available. Returns how many half-moves were actually undone. */
  undoMoves(count = 2): number {
    let undone = 0;
    for (let i = 0; i < count; i++) {
      const move = this.chess.undo();
      if (!move) break;
      undone++;
    }
    this.selected = null;
    this.pendingPromotion = null;
    this.arrow = null;
    const history = this.chess.history({ verbose: true });
    const last = history[history.length - 1];
    this.lastMove = last ? { from: last.from, to: last.to } : null;
    this.render();
    return undone;
  }

  getStatus(): GameStatus {
    if (this.chess.isCheckmate()) {
      // The side to move is the one who got mated.
      const winner = this.chess.turn() === "w" ? "black" : "white";
      return { over: true, result: "checkmate", winner };
    }
    if (this.chess.isStalemate()) return { over: true, result: "stalemate" };
    if (this.chess.isDraw()) return { over: true, result: "draw" };
    return { over: false, inCheck: this.chess.inCheck() };
  }

  // --- Live-analysis presentation hooks (driven externally by analysisPanel.ts) ---

  /** Draws (or clears, with undefined) a best-move arrow. Purely visual —
   * this board doesn't know or care that it came from an engine line. */
  showArrow(from?: Square, to?: Square): void {
    this.arrow = from && to ? { from, to } : null;
    this.render();
  }

  setHeatmapMode(mode: HeatmapMode): void {
    this.heatmapMode = mode;
    this.render();
  }

  // --- Drag-and-drop ---

  private squareFromPoint(x: number, y: number): Square | null {
    const el = document.elementFromPoint(x, y);
    const squareEl = el?.closest<HTMLElement>("[data-square]");
    return (squareEl?.dataset.square as Square | undefined) ?? null;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.locked || this.pendingPromotion) return;
    const squareEl = (e.target as HTMLElement).closest<HTMLElement>("[data-square]");
    if (!squareEl) return;
    const square = squareEl.dataset.square as Square;

    const piece = this.chess.get(square);
    if (!piece || piece.color !== this.chess.turn()) return; // only the mover's own pieces are draggable

    this.drag = {
      fromSquare: square,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      ghostEl: null,
      hoveredSquareEl: null,
    };
    this.selected = square;
    this.render();

    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      drag.moved = true;
      drag.ghostEl = this.createGhost(drag.fromSquare);
    }

    if (drag.ghostEl) {
      drag.ghostEl.style.left = `${e.clientX}px`;
      drag.ghostEl.style.top = `${e.clientY}px`;
    }

    const hoverSquare = this.squareFromPoint(e.clientX, e.clientY);
    const legalTargets = this.chess.moves({ square: drag.fromSquare, verbose: true }).map((m) => m.to);
    if (drag.hoveredSquareEl) drag.hoveredSquareEl.style.outline = "";
    if (hoverSquare && legalTargets.includes(hoverSquare)) {
      const el = this.container.querySelector<HTMLElement>(`[data-square="${hoverSquare}"]`);
      if (el) {
        el.style.outline = `3px solid ${DRAG_HOVER_COLOR}`;
        el.style.outlineOffset = "-3px";
        drag.hoveredSquareEl = el;
      }
    } else {
      drag.hoveredSquareEl = null;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;

    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    if (drag.hoveredSquareEl) drag.hoveredSquareEl.style.outline = "";
    if (drag.ghostEl) drag.ghostEl.remove();

    this.drag = null;

    if (!drag.moved) {
      // No real drag happened -- let the click handler (fires right after
      // pointerup) treat this as a normal tap/select.
      return;
    }
    this.suppressNextClick = true;

    const dropSquare = this.squareFromPoint(e.clientX, e.clientY);
    if (!dropSquare || dropSquare === drag.fromSquare) {
      this.selected = null;
      this.render();
      return;
    }

    this.attemptMove(drag.fromSquare, dropSquare);
  }

  private createGhost(square: Square): HTMLElement {
    const piece = this.chess.get(square);
    const ghost = document.createElement("div");
    ghost.className = "play-drag-ghost";
    if (piece) {
      ghost.textContent = PIECE_GLYPH[piece.color + piece.type];
      ghost.classList.add(piece.color === "w" ? "play-piece-white" : "play-piece-black");
    }
    document.body.appendChild(ghost);
    return ghost;
  }

  // --- Click-to-move (also the tap path when a drag doesn't happen) ---

  private onContainerClick(e: MouseEvent): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (this.pendingPromotion) {
      const promoTarget = (e.target as HTMLElement).closest<HTMLElement>("[data-promo]");
      if (promoTarget) this.finishPromotion(promoTarget.dataset.promo!);
      return;
    }
    if (this.locked) return;

    const squareEl = (e.target as HTMLElement).closest<HTMLElement>("[data-square]");
    if (!squareEl) return;
    this.handleTap(squareEl.dataset.square as Square);
  }

  private handleTap(square: Square): void {
    if (this.selected) {
      if (square === this.selected) return; // re-tapping the already-selected piece does nothing
      const legalMoves = this.chess.moves({ square: this.selected, verbose: true });
      const move = legalMoves.find((m) => m.to === square);
      if (move) {
        this.attemptMove(this.selected, square);
        return;
      }
      // Tapping another own piece re-selects instead of deselecting silently.
      const piece = this.chess.get(square);
      if (piece && piece.color === this.chess.turn()) {
        this.selected = square;
        this.render();
        return;
      }
      this.selected = null;
      this.render();
      return;
    }

    const piece = this.chess.get(square);
    if (piece && piece.color === this.chess.turn()) {
      this.selected = square;
      this.render();
    }
  }

  // --- Shared move commitment (drag drop and tap both funnel through here) ---

  private attemptMove(from: Square, to: Square): void {
    const legalMoves = this.chess.moves({ square: from, verbose: true });
    const move = legalMoves.find((m) => m.to === to);
    if (!move) {
      // Illegal drop/tap target -- snap back rather than silently no-op,
      // so the piece visibly returns instead of just staying selected.
      this.selected = null;
      this.render();
      return;
    }
    if (move.promotion) {
      this.pendingPromotion = { from, to };
      this.selected = null;
      this.render();
      return;
    }
    this.commitMove(from, to);
  }

  private finishPromotion(promotion: string): void {
    if (!this.pendingPromotion) return;
    const { from, to } = this.pendingPromotion;
    this.pendingPromotion = null;
    this.commitMove(from, to, promotion);
  }

  private commitMove(from: Square, to: Square, promotion?: string): void {
    const move = this.chess.move({ from, to, promotion });
    this.selected = null;
    this.lastMove = { from, to };
    this.arrow = null; // last position's best-move arrow doesn't apply to the new position
    this.render();
    this.onPlayerMove(from + to + (promotion ?? ""), move.san);
  }

  // --- Square-control heatmap (square-count of attackers per color) ---

  private controlTint(square: Square): string | null {
    const white = this.chess.attackers(square, "w").length;
    const black = this.chess.attackers(square, "b").length;
    if (white === black) return null;
    const net = white - black;
    const intensity = Math.min(1, Math.abs(net) / 3);
    // White control tints warm (matches the accent), Black control tints
    // cool -- opposite ends of a diverging scale around "contested."
    return net > 0
      ? `rgba(227, 168, 87, ${(0.12 + 0.28 * intensity).toFixed(2)})`
      : `rgba(91, 141, 239, ${(0.12 + 0.28 * intensity).toFixed(2)})`;
  }

  private render(): void {
    const files = "abcdefgh".split("");
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    const displayFiles = this.orientation === "white" ? files : [...files].reverse();
    const displayRanks = this.orientation === "white" ? ranks : [...ranks].reverse();

    const legalTargets = this.selected
      ? new Set(this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to))
      : new Set<string>();

    const kingInCheckSquare = this.chess.inCheck() ? this.findKingSquare(this.chess.turn()) : null;
    const isDraggingFrom = this.drag?.moved ? this.drag.fromSquare : null;

    let squaresHtml = "";
    for (const rank of displayRanks) {
      for (const file of displayFiles) {
        const square = `${file}${rank}` as Square;
        const isLight = (files.indexOf(file) + rank) % 2 === 1;
        let bg = isLight ? "var(--board-square-light)" : "var(--board-square-dark)";
        if (this.selected === square) bg = SELECTED_COLOR;
        else if (this.lastMove && (this.lastMove.from === square || this.lastMove.to === square)) bg = LAST_MOVE_COLOR;
        if (kingInCheckSquare === square) bg = CHECK_COLOR;

        const tint = this.heatmapMode === "control" ? this.controlTint(square) : null;

        const piece = this.chess.get(square);
        const glyph = piece ? PIECE_GLYPH[piece.color + piece.type] : "";
        const pieceColorClass = piece?.color === "w" ? "play-piece-white" : "play-piece-black";
        const dot = legalTargets.has(square) ? `<span class="play-legal-dot"></span>` : "";
        // The piece being actively dragged is dimmed in its origin square
        // (not hidden outright) so the square still reads clearly while
        // the ghost follows the cursor -- the same convention chess.com
        // uses rather than leaving a hard gap on the board.
        const dimStyle = square === isDraggingFrom ? "opacity:0.35" : "";

        squaresHtml += `
          <div class="play-square" data-square="${square}" style="background:${bg}">
            ${tint ? `<span class="play-heatmap-tint" style="background:${tint}"></span>` : ""}
            ${glyph ? `<span class="play-piece ${pieceColorClass}" style="${dimStyle}">${glyph}</span>` : ""}
            ${dot}
          </div>`;
      }
    }

    const promoOverlay = this.pendingPromotion
      ? `<div class="play-promo-overlay">
          <div class="play-promo-picker">
            ${["q", "r", "b", "n"]
              .map(
                (p) =>
                  `<button type="button" data-promo="${p}" class="play-promo-btn">${PIECE_GLYPH[this.chess.turn() + p]}</button>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

    const arrowSvg = this.arrow ? this.renderArrow(displayFiles, displayRanks) : "";

    this.container.innerHTML = `<div class="play-board">${squaresHtml}</div>${arrowSvg}${promoOverlay}`;
  }

  private renderArrow(displayFiles: string[], displayRanks: number[]): string {
    if (!this.arrow) return "";
    const squarePx = 100 / 8; // percent, so the overlay scales with the board regardless of actual pixel size
    const center = (square: Square) => {
      const file = displayFiles.indexOf(square[0]);
      const rank = displayRanks.indexOf(parseInt(square[1], 10));
      return { x: file * squarePx + squarePx / 2, y: rank * squarePx + squarePx / 2 };
    };
    const from = center(this.arrow.from);
    const to = center(this.arrow.to);
    return `
      <svg class="play-arrow-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <marker id="play-arrowhead" markerWidth="3.2" markerHeight="3.2" refX="1.6" refY="1.6" orient="auto">
            <path d="M0,0 L3.2,1.6 L0,3.2 Z" fill="rgba(227,168,87,0.9)"/>
          </marker>
        </defs>
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"
              stroke="rgba(227,168,87,0.9)" stroke-width="1.4" stroke-linecap="round"
              marker-end="url(#play-arrowhead)" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  private findKingSquare(color: "w" | "b"): Square | null {
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === "k" && cell.color === color) return cell.square;
      }
    }
    return null;
  }
}
