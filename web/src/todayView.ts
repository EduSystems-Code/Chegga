// Chegga Web — render for the "Today" daily session card.
// Pure: returns HTML. The Start buttons carry data-attributes; main.ts
// handles what they do (scroll to + configure the relevant card).

import type { TodayState, TodayStreak } from "./today";
import { isTodayComplete } from "./today";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderToday(state: TodayState, streak: TodayStreak): string {
  const complete = isTodayComplete(state);
  const doneCount = state.items.filter((i) => i.done >= i.target).length;

  const rows = state.items
    .map((item) => {
      const itemDone = item.done >= item.target;
      const dots = Array.from({ length: item.target }, (_, i) => `<span class="today-dot${i < item.done ? " today-dot-on" : ""}"></span>`).join("");
      const action = itemDone
        ? `<span class="today-check">✓</span>`
        : `<button type="button" class="today-start-btn" data-today-kind="${item.kind}">Start</button>`;
      return `
        <li class="today-item${itemDone ? " today-item-done" : ""}">
          <div class="today-item-main">
            <span class="today-item-label">${esc(item.label)}</span>
            <span class="today-dots">${dots}</span>
          </div>
          ${action}
        </li>`;
    })
    .join("");

  const header = complete
    ? `<p class="today-complete">Today's set complete ✓ &nbsp;<span class="status-line">🔥 ${streak.current}-day Today streak (best ${streak.best})</span></p>
       <p class="status-line">You can keep training below — nothing's locked. <button type="button" id="today-keep-going" class="today-start-btn">Keep training ↓</button></p>`
    : `<p class="status-line">${doneCount}/${state.items.length} done · 🔥 ${streak.current}-day Today streak</p>`;

  return `
    ${header}
    <ul class="today-list">${rows}</ul>
  `;
}
