// Chegga Web — 3D board view (toggleable, mouse-draggable 360° camera)
//
// A from-scratch Three.js scene, not a replacement for PlayBoard's 2D DOM
// board -- this is a "look at it" companion view. It mirrors PlayBoard's
// FEN and reuses the same piece art (pieceSet.ts) and board-theme colors
// (boardTheme.ts's CSS custom properties) so it reads as the same board,
// just rendered in 3D. Pieces are camera-facing sprites (billboards) built
// from the existing licensed 2D piece SVGs rather than modeled 3D
// geometry -- there's no 3D asset pipeline for this project, and
// billboarding the art that's already there keeps this consistent with
// "art stays generated or properly licensed" instead of adding a new
// asset dependency.
//
// Lazy-loaded (`import("./board3d")`) the same way the WASM engine and the
// puzzle JSON are -- kept out of the main bundle until a visitor actually
// opens the 3D view.

import * as THREE from "three";
import { Chess } from "chess.js";
import { pieceImgUrl } from "./pieceSet";

const SQUARE = 1; // world units per board square
const BOARD_HALF = SQUARE * 4;

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

export class Board3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private pieceGroup = new THREE.Group();
  private squareMeshes: THREE.Mesh[] = [];
  private textureLoader = new THREE.TextureLoader();
  private textureCache = new Map<string, THREE.Texture>();
  private resizeObserver: ResizeObserver;

  // Orbit camera state -- spherical coordinates around the board center,
  // driven by pointer drag. No fixed "front", since the whole point is a
  // free 360° look.
  private radius = 9;
  private theta = Math.PI / 4; // azimuth
  private phi = 0.9; // polar angle from +Y (clamped so it can't flip through the floor or go bird's-eye)
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private handlePointerDown = (e: PointerEvent) => this.onPointerDown(e);
  private handlePointerMove = (e: PointerEvent) => this.onPointerMove(e);
  private handlePointerUp = () => this.onPointerUp();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none"; // pointer-drag shouldn't also scroll the page on mobile
    this.renderer.domElement.style.cursor = "grab";
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    this.buildBoard();
    this.scene.add(this.pieceGroup);

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointermove", this.handlePointerMove);
    window.addEventListener("pointerup", this.handlePointerUp);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.resize();
    this.updateCamera();
    this.render();
  }

  private buildBoard(): void {
    const light = themeColor("--board-square-light", "#f0d9b5");
    const dark = themeColor("--board-square-dark", "#b58863");
    const geo = new THREE.BoxGeometry(SQUARE * 0.98, 0.12, SQUARE * 0.98);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        // a1 (file 0, rank 0) is a dark square on a real board.
        const isLight = (file + rank) % 2 === 1;
        const mat = new THREE.MeshStandardMaterial({ color: isLight ? light : dark, roughness: 0.7 });
        const mesh = new THREE.Mesh(geo, mat);
        const { x, z } = squarePos(file, rank);
        mesh.position.set(x, -0.06, z);
        this.scene.add(mesh);
        this.squareMeshes.push(mesh);
      }
    }
    // A slightly larger, darker base slab under the board for real depth,
    // so it reads as a physical board and not a floating checkerboard.
    const baseMat = new THREE.MeshStandardMaterial({ color: dark.clone().multiplyScalar(0.55), roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(SQUARE * 8.6, 0.3, SQUARE * 8.6), baseMat);
    base.position.set(0, -0.27, 0);
    this.scene.add(base);
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

  private getTexture(color: "w" | "b", type: string): THREE.Texture | null {
    const url = pieceImgUrl(color, type);
    if (!url) return null; // the Unicode piece set has no image -- 3D view needs one of the SVG sets
    const cached = this.textureCache.get(url);
    if (cached) return cached;
    const tex = this.textureLoader.load(url, () => this.render()); // re-render once the SVG actually decodes
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textureCache.set(url, tex);
    return tex;
  }

  /** Rebuilds the piece layer from a FEN. Safe to call on every move. */
  setPosition(fen: string): void {
    this.pieceGroup.children.forEach((child) => {
      if (child instanceof THREE.Sprite) child.material.dispose();
    });
    this.pieceGroup.clear();

    const chess = new Chess(fen);
    for (const row of chess.board()) {
      for (const piece of row) {
        if (!piece) continue;
        const file = piece.square.charCodeAt(0) - "a".charCodeAt(0);
        const rank = parseInt(piece.square[1], 10) - 1;
        const tex = this.getTexture(piece.color, piece.type);
        if (!tex) continue;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.85, 0.85, 0.85);
        const { x, z } = squarePos(file, rank);
        sprite.position.set(x, 0.45, z);
        this.pieceGroup.add(sprite);
      }
    }
    this.render();
  }

  private onPointerDown(e: PointerEvent): void {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.theta -= dx * 0.01;
    this.phi = Math.min(Math.max(this.phi - dy * 0.01, 0.35), Math.PI / 2 - 0.05);
    this.updateCamera();
    this.render();
  }

  private onPointerUp(): void {
    this.dragging = false;
    this.renderer.domElement.style.cursor = "grab";
  }

  private updateCamera(): void {
    this.camera.position.set(
      this.radius * Math.sin(this.phi) * Math.sin(this.theta),
      this.radius * Math.cos(this.phi),
      this.radius * Math.sin(this.phi) * Math.cos(this.theta),
    );
    this.camera.lookAt(0, 0, 0);
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
    window.removeEventListener("pointermove", this.handlePointerMove);
    window.removeEventListener("pointerup", this.handlePointerUp);
    this.textureCache.forEach((tex) => tex.dispose());
    this.pieceGroup.children.forEach((child) => {
      if (child instanceof THREE.Sprite) child.material.dispose();
    });
    this.squareMeshes.forEach((m) => (m.material as THREE.Material).dispose());
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
