// Chegga Web — "juice": the visual feedback that makes finishing a thing
// feel like finishing a thing. Confetti, floating +N text, element
// bump/shake/flash, number count-up, and an achievement banner.
//
// No dependencies, no assets — a single reused <canvas> overlay for
// confetti, everything else is CSS-class toggles + rAF. Every effect
// checks the "effects enabled" preference and prefers-reduced-motion,
// and degrades to something quiet (or nothing) rather than being
// skipped in a way that breaks the calling code.

const EFFECTS_KEY = "chegga-web:effects-enabled";

export function effectsEnabled(): boolean {
  try {
    if (localStorage.getItem(EFFECTS_KEY) === "0") return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function setEffectsEnabled(on: boolean): void {
  try {
    localStorage.setItem(EFFECTS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function on(): boolean {
  return effectsEnabled();
}

// --- element micro-effects ---------------------------------------------

/** Re-triggerable: removes the class, forces reflow, re-adds it, then
 * cleans up after `ms`. */
function pulseClass(el: HTMLElement | null | undefined, cls: string, ms: number): void {
  if (!el || !on()) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation restarts
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

export function bump(el: HTMLElement | null | undefined): void {
  if (reducedMotion()) return;
  pulseClass(el, "juice-bump", 400);
}

export function shake(el: HTMLElement | null | undefined): void {
  if (reducedMotion()) return;
  pulseClass(el, "juice-shake", 450);
}

/** Brief coloured glow. `tone` picks the palette: good / bad / gold. */
export function flash(el: HTMLElement | null | undefined, tone: "good" | "bad" | "gold" = "good"): void {
  pulseClass(el, `juice-flash-${tone}`, 650);
}

// --- floating text ----------------------------------------------------

/** A small label that rises and fades just above `anchor` — e.g. "+12"
 * next to the rating, "Redeemed!" on the board. */
export function floatText(anchor: HTMLElement | null | undefined, text: string, tone: "good" | "bad" | "gold" = "good"): void {
  if (!anchor || !on() || reducedMotion()) return;
  const rect = anchor.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `juice-float juice-float-${tone}`;
  el.textContent = text;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top}px`;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1100);
}

// --- number count-up ------------------------------------------------

/** Animates `el`'s text from `from` to `to` over ~500ms. Instant (just
 * sets the final value) under reduced-motion / effects-off. */
export function countUp(el: HTMLElement | null | undefined, from: number, to: number, ms = 550): void {
  if (!el) return;
  if (!on() || reducedMotion() || from === to) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - (1 - t) * (1 - t);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --- confetti -------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
}

let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let rafId = 0;

const CONFETTI_COLORS = ["#e3a857", "#4ade80", "#63b3ed", "#f2a13f", "#f2555a", "#ffffff"];

function ensureCanvas(): HTMLCanvasElement {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "juice-confetti";
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1200",
    } as CSSStyleDeclaration);
    document.body.appendChild(canvas);
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  return canvas;
}

function tick(): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.vy += 0.18; // gravity
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 30));
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    ctx.restore();
  }
  if (particles.length > 0) {
    rafId = requestAnimationFrame(tick);
  } else {
    cancelAnimationFrame(rafId);
    rafId = 0;
    canvas.remove();
    canvas = null;
  }
}

/** A confetti burst. Origin defaults to screen centre; pass an element
 * to burst from its middle. `power` scales particle count + spread. */
export function confetti(origin?: HTMLElement | null, power = 1): void {
  if (!on() || reducedMotion()) {
    // reduced-motion still gets a small acknowledgement
    if (origin) flash(origin, "gold");
    return;
  }
  const c = ensureCanvas();
  let cx = c.width / 2;
  let cy = c.height / 3;
  if (origin) {
    const r = origin.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
  }
  const count = Math.round(70 * power);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 7) * power;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      size: 5 + Math.random() * 7,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 60 + Math.random() * 40,
    });
  }
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** Big celebratory moment — a strong burst plus a brief screen-edge
 * glow. For Today-complete, a redemption, beating the bot, an
 * achievement. */
export function celebrate(origin?: HTMLElement | null): void {
  confetti(origin, 1.6);
  if (!on() || reducedMotion()) return;
  const glow = document.createElement("div");
  glow.className = "juice-screen-glow";
  document.body.appendChild(glow);
  window.setTimeout(() => glow.remove(), 900);
}

// --- achievement banner --------------------------------------------

/** A slide-in banner, distinct from the plain status toast — for
 * achievement unlocks. Stacks if several fire at once. */
export function achievementBanner(title: string, subtitle: string): void {
  let host = document.getElementById("juice-banner-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "juice-banner-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "juice-banner";
  el.innerHTML = `<span class="juice-banner-medal">🏅</span><span class="juice-banner-text"><strong>${escapeHtml(
    title,
  )}</strong><span>${escapeHtml(subtitle)}</span></span>`;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("juice-banner-in"));
  window.setTimeout(() => {
    el.classList.remove("juice-banner-in");
    window.setTimeout(() => el.remove(), 400);
  }, 4200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
