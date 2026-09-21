// Chegga Web — first-run tutorial: the markup
//
// The tutorial is a full-screen dialog: the board on one side, the guide on
// the other (stacked on a phone). This file is only strings; tutorial.ts
// owns the behavior. Anything that came from outside (a username, an
// opponent's name) is set with textContent by the controller, never put in
// here as HTML.

import { getClassColor } from "./classificationColors";
import type { Site } from "./siteSync";

// The same mark as the page header, so the guide reads as Chegga's own.
const BRAND_MARK = `<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect width="64" height="64" rx="14" fill="#12151b" />
  <rect x="12" y="12" width="10" height="10" fill="#e3a857" />
  <rect x="32" y="12" width="10" height="10" fill="#e3a857" />
  <rect x="22" y="22" width="10" height="10" fill="#e3a857" />
  <rect x="42" y="22" width="10" height="10" fill="#e3a857" />
  <rect x="12" y="32" width="10" height="10" fill="#e3a857" />
  <rect x="32" y="32" width="10" height="10" fill="#e3a857" />
  <rect x="22" y="42" width="10" height="10" fill="#e3a857" />
  <rect x="42" y="42" width="10" height="10" fill="#e3a857" />
  <rect x="12" y="12" width="40" height="40" fill="none" stroke="#f0be73" stroke-width="2" />
</svg>`;

export const TUTORIAL_STEPS = ["Welcome", "Your game", "The position", "Heatmap", "Best move", "Your move", "What Chegga does"];

export function overlayHtml(): string {
  const dots = TUTORIAL_STEPS.map((label) => `<li data-step-label="${label}"></li>`).join("");
  return `
  <div class="tutorial-panel">
    <header class="tutorial-top">
      <div class="tutorial-brand">${BRAND_MARK}<span>Chegga</span></div>
      <ol class="tutorial-dots" id="tutorial-dots" aria-label="Tutorial progress">${dots}</ol>
      <button type="button" class="btn-quiet tutorial-skip" id="tutorial-skip">Skip tutorial</button>
    </header>
    <div class="tutorial-body">
      <div class="tutorial-stage">
        <div class="play-board-wrap tutorial-board" id="tutorial-board"></div>
        <p class="tutorial-caption" id="tutorial-caption"></p>
        <div class="tutorial-legend" id="tutorial-legend" hidden>${legendHtml()}</div>
      </div>
      <section class="tutorial-guide" aria-live="off">
        <div class="tutorial-speaker">
          <span class="tutorial-avatar" aria-hidden="true">${BRAND_MARK}</span>
          <span class="tutorial-speaker-name">Your Chegga guide</span>
        </div>
        <div class="tutorial-bubble">
          <h2 class="tutorial-title" id="tutorial-title" tabindex="-1"></h2>
          <div class="tutorial-say" id="tutorial-say" aria-hidden="true"></div>
          <div class="sr-only" id="tutorial-say-live" aria-live="polite"></div>
        </div>
        <div class="tutorial-controls" id="tutorial-controls"></div>
      </section>
    </div>
  </div>`;
}

/** What the heatmap colors mean, in the viewer's own palette (so the
 * colour-blind setting applies here too). */
export function legendHtml(): string {
  const item = (tier: string, label: string) =>
    `<span class="tutorial-legend-item"><i style="background:${getClassColor(tier)}"></i>${label}</span>`;
  return `${item("best", "Best")}${item("excellent", "Very good")}${item("good", "Good")}<span class="tutorial-legend-note">Deeper color = stronger move</span>`;
}

export function connectFormHtml(defaultSite: Site): string {
  const site = (value: Site, label: string) =>
    `<label class="tutorial-site"><input type="radio" name="tutorial-site" value="${value}"${defaultSite === value ? " checked" : ""} /><span>${label}</span></label>`;
  return `
  <form id="tutorial-form" class="tutorial-form" novalidate>
    <div class="tutorial-sites" role="radiogroup" aria-label="Where do you play?">
      ${site("chesscom", "Chess.com")}
      ${site("lichess", "Lichess")}
    </div>
    <label for="tutorial-username" class="sr-only">Your username</label>
    <input id="tutorial-username" class="tutorial-input" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Your username" maxlength="30" />
    <p class="tutorial-form-note">Just your username. Chegga never asks for a password. It reads your public games, and nothing leaves your browser except that request.</p>
    <p class="tutorial-error" id="tutorial-error" role="alert"></p>
    <button type="submit" class="tutorial-primary">Look at my latest game</button>
    <button type="button" class="tutorial-link" id="tutorial-example">No account? Try an example game instead</button>
  </form>`;
}

export function scanningHtml(): string {
  return `
  <div class="tutorial-progress" aria-hidden="true"><div class="tutorial-progress-bar"></div></div>
  <p class="tutorial-progress-text" id="tutorial-progress-text" role="status"></p>
  <button type="button" class="tutorial-link" id="tutorial-example" hidden>Use an example game instead</button>`;
}

export function nextButtonHtml(label: string): string {
  return `<button type="button" class="tutorial-primary" id="tutorial-next">${label}</button>`;
}

export function waitingHtml(text: string): string {
  return `<p class="tutorial-hint">${text}</p>`;
}
