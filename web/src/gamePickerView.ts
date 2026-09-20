// Chegga Web — game picker: the markup
//
// A row of swipeable game cards (native horizontal scroll with snap, so a
// thumb swipe and a trackpad both work; the two arrow buttons cover a mouse
// wheel that only scrolls vertically) under a row of result filters. Below
// it, the positions the viewer saved from a review. All strings that come
// from the network or the viewer (usernames, opening names, saved moves)
// are escaped.

import type { PickerCard, PickerFilter } from "./gamePicker";
import type { SavedPuzzleRecord } from "./db";
import { describeSavedPuzzle } from "./savedPuzzles";

function esc(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const RESULT_LABEL: Record<PickerCard["result"], string> = { win: "Win", loss: "Loss", draw: "Draw" };

const FILTERS: { id: PickerFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "win", label: "Wins" },
  { id: "loss", label: "Losses" },
  { id: "draw", label: "Draws" },
  { id: "analyzed", label: "Analyzed" },
];

function formatDate(endTime: number): string {
  if (!endTime) return "";
  return new Date(endTime * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function statusLine(card: PickerCard, busy: boolean): string {
  if (!card.supported) return "Variant game — can't be reviewed";
  if (busy) return "Analyzing…";
  return card.analyzed ? "Ready to review" : "Analyze & review";
}

function renderCard(card: PickerCard, busyId: string | null): string {
  const busy = busyId === card.id;
  const disabled = !card.supported || (busyId !== null && !busy);
  const classes = ["picker-card", `picker-card-${card.result}`, card.analyzed ? "picker-card-ready" : "", busy ? "picker-card-busy" : ""]
    .filter(Boolean)
    .join(" ");
  const meta = [formatDate(card.endTime), card.timeClass, `as ${card.color === "white" ? "White" : "Black"}`]
    .filter(Boolean)
    .join(" · ");
  const label = `${RESULT_LABEL[card.result]} against ${card.opponent}, ${meta}`;
  return `<button type="button" class="${classes}" data-game-id="${esc(card.id)}" ${disabled ? "disabled" : ""} aria-label="${esc(label)}">
    <span class="picker-result">${RESULT_LABEL[card.result]}</span>
    <span class="picker-vs">vs <strong>${esc(card.opponent)}</strong> <span class="picker-rating">${card.opponentRating || ""}</span></span>
    <span class="picker-meta">${esc(meta)}</span>
    <span class="picker-opening">${card.opening ? esc(card.opening) : "&nbsp;"}</span>
    <span class="picker-status">${statusLine(card, busy)}</span>
  </button>`;
}

export function renderGamePicker(
  cards: PickerCard[],
  counts: Record<PickerFilter, number>,
  filter: PickerFilter,
  busyId: string | null,
): string {
  const chips = FILTERS.map(
    (f) =>
      `<button type="button" class="picker-filter${f.id === filter ? " picker-filter-active" : ""}" data-picker-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label} <span class="picker-count">${counts[f.id]}</span></button>`,
  ).join("");
  const body = cards.length
    ? `<div class="picker-carousel">
        <button type="button" class="picker-nav" data-picker-nav="-1" aria-label="Scroll to newer games">◀</button>
        <div class="picker-track" id="picker-track" tabindex="0" role="group" aria-label="Your games, newest first">${cards.map((c) => renderCard(c, busyId)).join("")}</div>
        <button type="button" class="picker-nav" data-picker-nav="1" aria-label="Scroll to older games">▶</button>
      </div>
      <p class="picker-hint">Swipe or scroll for older games. Games that aren't analyzed yet are analyzed when you open them (about half a minute).</p>`
    : `<p class="status-line">No games match this filter.</p>`;
  return `<div class="picker-filters" role="group" aria-label="Filter your games">${chips}</div>${body}`;
}

export function renderSavedPositions(saved: SavedPuzzleRecord[], solvedIds: Set<string>): string {
  if (!saved.length) return "";
  const rows = saved
    .map((p) => {
      const solved = solvedIds.has(p.id);
      return `<li class="saved-row">
        <div class="saved-text">
          <span class="saved-title">${p.sideToMove === "white" ? "White" : "Black"} to move${solved ? ` <span class="saved-solved">solved</span>` : ""}</span>
          <span class="saved-meta">${esc(describeSavedPuzzle(p))}${p.openingName ? ` · ${esc(p.openingName)}` : ""}</span>
        </div>
        <button type="button" class="btn-quiet" data-saved-try="${esc(p.id)}">Try it</button>
        <button type="button" class="btn-quiet" data-saved-remove="${esc(p.id)}" aria-label="Remove this saved position">Remove</button>
      </li>`;
    })
    .join("");
  return `<h3 class="picker-subheading">Saved positions <span class="picker-count">${saved.length}</span></h3><ul class="saved-list">${rows}</ul>`;
}
