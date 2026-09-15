// Chegga Web — 3D board view (toggleable, mouse/touch-draggable 360°
// camera, wheel/pinch zoom)
//
// A from-scratch Three.js scene, not a replacement for PlayBoard's 2D DOM
// board -- this is a "look at it" companion view. Pieces are real
// generated 3D geometry (THREE.LatheGeometry -- the same technique an
// actual wood lathe uses to turn a Staunton piece -- for the five
// radially-symmetric pieces, a handful of merged primitives for the
// knight, the one piece that isn't a surface of revolution), not the
// existing 2D piece art: there's no 3D asset pipeline for this project
// and no properly-licensed 3D chess-piece set to reuse, so these are
// code-generated, matching "art stays generated or properly licensed"
// rather than adding an unverified new asset dependency. Board squares
// still read the live board-theme CSS colors, so it stays visually tied
// to the 2D board.
//
// Lazy-loaded (`import("./board3d")`) the same way the WASM engine and the
// puzzle JSON are -- kept out of the main bundle until a visitor actually
// opens the 3D view.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Chess } from "chess.js";

const SQUARE = 1; // world units per board square
const BOARD_HALF = SQUARE * 4;

type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

function themeColor(varName: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(v || fallback);
}

function squarePos(file: number, rank: number): { x: number; z: number } {
  return {
    x: file * SQUARE - BOARD_HALF + SQUARE / 2,
    z: rank * SQUARE - BOARD_HALF + SQUARE / 2,
  };
}

// --- Procedural piece geometry -------------------------------------------
//
// Each profile is a list of [radius, height] pairs, bottom to top, fed to
// THREE.LatheGeometry (a full revolution around the Y axis) -- the classic
// way to build a turned, radially-symmetric object from a 2D silhouette.
// Ending a profile at radius 0 closes it to a point; two points that share
// a height instead close it to a flat disc (used for the rook's deck).

function lathePoints(profile: number[][]): THREE.Vector2[] {
  return profile.map(([r, y]) => new THREE.Vector2(r, y));
}

function buildLathe(profile: number[][]): THREE.BufferGeometry {
  return new THREE.LatheGeometry(lathePoints(profile), 28);
}

const PAWN_PROFILE = [
  [0.3, 0.0], [0.3, 0.02], [0.22, 0.05], [0.15, 0.09],
  [0.13, 0.16], [0.17, 0.23], [0.11, 0.28],
  [0.19, 0.34], [0.19, 0.36], [0.0, 0.47],
];

const ROOK_PROFILE = [
  [0.32, 0.0], [0.32, 0.02], [0.24, 0.05], [0.2, 0.1],
  [0.2, 0.34], [0.27, 0.38], [0.27, 0.44], [0.3, 0.46], [0.3, 0.5],
  [0.0, 0.5],
];

const BISHOP_PROFILE = [
  [0.28, 0.0], [0.28, 0.02], [0.2, 0.05], [0.15, 0.1],
  [0.11, 0.3], [0.1, 0.45],
  [0.16, 0.52], [0.16, 0.55], [0.08, 0.6],
  [0.14, 0.66], [0.14, 0.68],
  [0.0, 0.76],
];

const QUEEN_PROFILE = [
  [0.32, 0.0], [0.32, 0.02], [0.23, 0.05], [0.18, 0.1],
  [0.13, 0.35], [0.12, 0.55],
  [0.22, 0.62], [0.26, 0.66], [0.26, 0.7], [0.2, 0.72],
  [0.14, 0.78], [0.14, 0.8],
  [0.0, 0.87],
];

const KING_BODY_PROFILE = [
  [0.32, 0.0], [0.32, 0.02], [0.23, 0.05], [0.18, 0.1],
  [0.13, 0.35], [0.12, 0.58],
  [0.22, 0.64], [0.26, 0.68], [0.26, 0.72], [0.2, 0.74],
  [0.15, 0.78], [0.15, 0.8],
  [0.08, 0.85],
];

const KNIGHT_BASE_PROFILE = [
  [0.3, 0.0], [0.3, 0.02], [0.22, 0.05], [0.17, 0.09],
  [0.13, 0.2], [0.14, 0.26], [0.16, 0.3],
];

function buildKingGeometry(): THREE.BufferGeometry {
  const body = buildLathe(KING_BODY_PROFILE);
  const vBar = new THREE.BoxGeometry(0.035, 0.16, 0.035);
  vBar.translate(0, 0.93, 0);
  const hBar = new THREE.BoxGeometry(0.11, 0.035, 0.035);
  hBar.translate(0, 0.9, 0);
  return mergeGeometries([body, vBar, hBar], false) ?? body;
}

/** The one piece that isn't a surface of revolution -- built from a few
 * primitives instead of a lathe, which is exactly what makes it read as
 * "the knight" next to five turned pieces, from any angle you drag to. */
function buildKnightGeometry(): THREE.BufferGeometry {
  const base = buildLathe(KNIGHT_BASE_PROFILE);

  const neck = new THREE.CylinderGeometry(0.075, 0.11, 0.3, 16);
  neck.rotateX(-0.6);
  neck.translate(0, 0.3, 0.06);

  const head = new THREE.SphereGeometry(0.12, 16, 12);
  head.scale(1, 0.85, 1.3);
  head.translate(0, 0.47, 0.17);

  const muzzle = new THREE.ConeGeometry(0.06, 0.18, 12);
  muzzle.rotateX(Math.PI / 2 + 0.35);
  muzzle.translate(0, 0.42, 0.29);

  const earL = new THREE.ConeGeometry(0.03, 0.09, 8);
  earL.translate(-0.05, 0.56, 0.11);
  const earR = new THREE.ConeGeometry(0.03, 0.09, 8);
  earR.translate(0.05, 0.56, 0.11);

  return mergeGeometries([base, neck, head, muzzle, earL, earR], false) ?? base;
}

function buildPieceGeometries(): Record<PieceType, THREE.BufferGeometry> {
  return {
    p: buildLathe(PAWN_PROFILE),
    r: buildLathe(ROOK_PROFILE),
    b: buildLathe(BISHOP_PROFILE),
    q: buildLathe(QUEEN_PROFILE),
    k: buildKingGeometry(),
    n: buildKnightGeometry(),
  };
}

export class Board3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private pieceGroup = new THREE.Group();
  private squareMeshes: THREE.Mesh[] = [];
  private squareGeometry!: THREE.BufferGeometry;
  private baseMesh!: THREE.Mesh;
  private pieceGeometries = buildPieceGeometries();
  private pieceMaterials: Record<"w" | "b", THREE.MeshStandardMaterial> = {
    w: new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.45, metalness: 0.05 }),
    b: new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.5, metalness: 0.05 }),
  };
  private resizeObserver: ResizeObserver;

  // Orbit camera state -- spherical coordinates around the board center,
  // driven by pointer drag. No fixed "front", since the whole point is a
  // free 360° look.
  // radius 9 was too close -- the board's corner-to-corner half-diagonal
  // (~5.66 units) doesn't fit inside a 45° FOV frustum until roughly
  // radius 13.7 (5.66 / tan(22.5°)); 14 leaves a bit of margin.
  private radius = 14;
  private readonly minRadius = 6;
  private readonly maxRadius = 26;
  private theta = Math.PI / 4; // azimuth
  private phi = 0.75; // polar angle from +Y -- a bit more overhead than eye-level, so the far side of the board isn't as foreshortened
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // Pointer tracking supports both one-finger/mouse orbit and two-finger
  // pinch-to-zoom -- the same Pointer Events API handles mouse and touch,
  // so this is one code path, not two.
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDistance = 0;
  private pinchStartRadius = 14;

  // A single pointer doesn't start orbiting immediately -- it's a "maybe
  // a tap" candidate until it moves past TAP_MOVE_PX, mirroring
  // PlayBoard's own tap-vs-drag threshold. If it never crosses that, it's
  // a click-to-move square tap instead of a camera drag.
  private tapCandidate: { pointerId: number; startX: number; startY: number } | null = null;
  private readonly TAP_MOVE_PX = 6;
  private raycaster = new THREE.Raycaster();
  /** Fired with an algebraic square ("e4") when a tap (not a drag) hits a
   * board square -- set by the caller (main.ts) to drive PlayBoard's
   * tapSquare(), so this class stays chess-rule-agnostic. */
  onSquareClick?: (square: string) => void;

  private handlePointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private handlePointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private handlePointerUp = (e: PointerEvent) => this.onPointerUp(e);
  private handleWheel = (e: WheelEvent) => this.onWheel(e);

  constructor(container: HTMLElement, orientation: "white" | "black" = "white") {
    this.container = container;
    // Start looking from the human player's own corner (a1 for White, h8
    // for Black) -- it's still a free 360° drag from there, just a saner
    // first frame than an arbitrary angle.
    this.theta = orientation === "white" ? (5 * Math.PI) / 4 : Math.PI / 4;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none"; // pointer-drag/pinch shouldn't also scroll the page
    this.renderer.domElement.style.cursor = "grab";
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(-6, 5, -4);
    this.scene.add(fillLight);

    this.buildBoard();
    this.scene.add(this.pieceGroup);

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    this.renderer.domElement.addEventListener("wheel", this.handleWheel, { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.resize();
    this.updateCamera();
    this.render();
  }

  private buildBoard(): void {
    const light = themeColor("--board-square-light", "#f0d9b5");
    const dark = themeColor("--board-square-dark", "#b58863");
    this.squareGeometry = new THREE.BoxGeometry(SQUARE * 0.98, 0.12, SQUARE * 0.98);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        // a1 (file 0, rank 0) is a dark square on a real board.
        const isLight = (file + rank) % 2 === 1;
        const mat = new THREE.MeshStandardMaterial({ color: isLight ? light : dark, roughness: 0.7 });
        const mesh = new THREE.Mesh(this.squareGeometry, mat);
        const { x, z } = squarePos(file, rank);
        mesh.position.set(x, -0.06, z);
        this.scene.add(mesh);
        this.squareMeshes.push(mesh);
      }
    }
    // A slightly larger, darker base slab under the board for real depth,
    // so it reads as a physical board and not a floating checkerboard.
    const baseMat = new THREE.MeshStandardMaterial({ color: dark.clone().multiplyScalar(0.55), roughness: 0.9 });
    this.baseMesh = new THREE.Mesh(new THREE.BoxGeometry(SQUARE * 8.6, 0.3, SQUARE * 8.6), baseMat);
    this.baseMesh.position.set(0, -0.27, 0);
    this.scene.add(this.baseMesh);
  }

  /** Re-reads the CSS theme variables. Call after the board-theme picker changes. */
  refreshTheme(): void {
    const light = themeColor("--board-square-light", "#f0d9b5");
    const dark = themeColor("--board-square-dark", "#b58863");
    this.squareMeshes.forEach((mesh, i) => {
      const rank = Math.floor(i / 8);
      const file = i % 8;
      const isLight = (file + rank) % 2 === 1;
      (mesh.material as THREE.MeshStandardMaterial).color = (isLight ? light : dark).clone();
    });
    this.render();
  }

  /** Tints the selected square and its legal destinations via each square
   * mesh's own emissive channel -- doesn't touch `color`, so it composes
   * cleanly with refreshTheme(). Call after every tapSquare()/onSquareClick
   * round trip, since selecting (not just moving) changes what should glow. */
  setSelection(selected: string | null, legalTargets: string[]): void {
    const legal = new Set(legalTargets);
    this.squareMeshes.forEach((mesh, i) => {
      const rank = Math.floor(i / 8);
      const file = i % 8;
      const square = `${String.fromCharCode(97 + file)}${rank + 1}`;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (square === selected) {
        mat.emissive.setHex(0x4a7a3a);
        mat.emissiveIntensity = 0.7;
      } else if (legal.has(square)) {
        mat.emissive.setHex(0x2f5a2f);
        mat.emissiveIntensity = 0.45;
      } else {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 0;
      }
    });
    this.render();
  }

  /** Briefly highlights `square` (the destination of the move just
   * played) via the same emissive-channel technique as setSelection() --
   * a colored glow that fades back to none. Purely presentational, same
   * as setSelection(): this class doesn't know or care that `color` came
   * from a move-quality classification. Safe to assume no square is
   * selected when this fires (a completed move always clears selection),
   * so the timeout just clears emissive rather than replaying setSelection. */
  flashSquareQuality(square: string, color: string, ms = 900): void {
    const idx = this.squareMeshes.findIndex((_, i) => {
      const rank = Math.floor(i / 8);
      const file = i % 8;
      return `${String.fromCharCode(97 + file)}${rank + 1}` === square;
    });
    if (idx < 0) return;
    const mat = this.squareMeshes[idx].material as THREE.MeshStandardMaterial;
    mat.emissive.set(new THREE.Color(color));
    mat.emissiveIntensity = 0.85;
    this.render();
    window.setTimeout(() => {
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
      this.render();
    }, ms);
  }

  /** Moves the canvas into a different container (e.g. the small inline
   * wrap -> the full-screen overlay) without rebuilding the scene. */
  remount(container: HTMLElement): void {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** Rebuilds the piece layer from a FEN. Safe to call on every move --
   * geometries and materials are shared/persistent, so this only touches
   * per-instance mesh placement, not the GPU resources behind them. */
  setPosition(fen: string): void {
    this.pieceGroup.clear();
    const chess = new Chess(fen);
    for (const row of chess.board()) {
      for (const piece of row) {
        if (!piece) continue;
        const file = piece.square.charCodeAt(0) - "a".charCodeAt(0);
        const rank = parseInt(piece.square[1], 10) - 1;
        const geo = this.pieceGeometries[piece.type as PieceType];
        const mat = this.pieceMaterials[piece.color];
        const mesh = new THREE.Mesh(geo, mat);
        const { x, z } = squarePos(file, rank);
        mesh.position.set(x, 0, z); // every profile is modeled with its foot at y=0
        if (piece.type === "n") mesh.rotation.y = piece.color === "w" ? 0 : Math.PI;
        this.pieceGroup.add(mesh);
      }
    }
    this.render();
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.renderer.domElement.setPointerCapture(e.pointerId);
    if (this.pointers.size === 1) {
      // Not a drag yet -- could still resolve to a square tap. Orbiting
      // only starts once this pointer actually moves (onPointerMove).
      this.dragging = false;
      this.tapCandidate = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else if (this.pointers.size === 2) {
      this.dragging = false; // a second finger joined -- this is a pinch now, not an orbit drag
      this.tapCandidate = null;
      this.pinchStartDistance = this.pinchDistance();
      this.pinchStartRadius = this.radius;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      const dist = this.pinchDistance();
      if (this.pinchStartDistance > 0) {
        const ratio = this.pinchStartDistance / dist; // fingers spreading apart -> zoom in -> smaller radius
        this.setRadius(this.pinchStartRadius * ratio);
      }
      return;
    }

    if (this.tapCandidate && this.tapCandidate.pointerId === e.pointerId) {
      const dx = e.clientX - this.tapCandidate.startX;
      const dy = e.clientY - this.tapCandidate.startY;
      if (Math.hypot(dx, dy) < this.TAP_MOVE_PX) return; // still within tap tolerance -- don't orbit yet
      this.tapCandidate = null;
      this.dragging = true;
      this.renderer.domElement.style.cursor = "grabbing";
    }

    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.theta -= dx * 0.01;
    this.phi = Math.min(Math.max(this.phi - dy * 0.01, 0.15), Math.PI / 2 - 0.02);
    this.updateCamera();
    this.render();
  }

  private onPointerUp(e: PointerEvent): void {
    const wasTap = this.tapCandidate?.pointerId === e.pointerId;
    this.pointers.delete(e.pointerId);
    this.tapCandidate = null;
    if (wasTap) this.handleSquareTap(e);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.renderer.domElement.style.cursor = "grab";
    } else if (this.pointers.size === 1) {
      // Dropped from two fingers to one -- resume single-finger orbit from
      // that finger's current position instead of jumping the camera.
      const remaining = [...this.pointers.values()][0];
      this.lastX = remaining.x;
      this.lastY = remaining.y;
      this.dragging = true;
    }
  }

  /** A completed tap (pointerdown+up with negligible movement) that hit a
   * board square, translated into an algebraic square and handed to
   * whoever set onSquareClick. */
  private handleSquareTap(e: PointerEvent): void {
    if (!this.onSquareClick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.squareMeshes, false);
    if (hits.length === 0) return;
    const idx = this.squareMeshes.indexOf(hits[0].object as THREE.Mesh);
    if (idx < 0) return;
    const rank = Math.floor(idx / 8);
    const file = idx % 8;
    this.onSquareClick(`${String.fromCharCode(97 + file)}${rank + 1}`);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault(); // zoom the board, not the page
    this.setRadius(this.radius * Math.exp(e.deltaY * 0.001));
  }

  private pinchDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private setRadius(r: number): void {
    this.radius = Math.min(Math.max(r, this.minRadius), this.maxRadius);
    this.updateCamera();
    this.render();
  }

  private updateCamera(): void {
    this.camera.position.set(
      this.radius * Math.sin(this.phi) * Math.sin(this.theta),
      this.radius * Math.cos(this.phi),
      this.radius * Math.sin(this.phi) * Math.cos(this.theta),
    );
    this.camera.lookAt(0, 0.3, 0);
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || w;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Tears down the renderer/listeners/GPU resources. Call when the 3D view is toggled off for good (not just hidden). */
  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    Object.values(this.pieceGeometries).forEach((g) => g.dispose());
    Object.values(this.pieceMaterials).forEach((m) => m.dispose());
    this.squareGeometry.dispose();
    this.squareMeshes.forEach((m) => (m.material as THREE.Material).dispose());
    this.baseMesh.geometry.dispose();
    (this.baseMesh.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
