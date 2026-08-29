// Chegga Web — rendering for weeklyPlan.ts

import type { WeeklyPlan } from "./weeklyPlan";
import { SKILL_CATEGORY_LABELS } from "./skillProfile";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderWeeklyPlan(plan: WeeklyPlan, doneIds: Set<string>): string {
  const doneCount = plan.days.reduce((s, d) => s + d.tasks.filter((t) => doneIds.has(t.id)).length, 0);

  const focusLine = plan.focus
    ? `Weighted toward your weakest area right now: <strong>${esc(SKILL_CATEGORY_LABELS[plan.focus])}</strong>.`
    : `Analyze a few games to have this weighted toward your weakest area.`;

  const days = plan.days
    .map((day) => {
      const tasks = day.tasks
        .map((t) => {
          const done = doneIds.has(t.id);
          return `
            <li class="plan-task${done ? " plan-task-done" : ""}">
              <label>
                <input type="checkbox" class="plan-check" data-task="${esc(t.id)}"${done ? " checked" : ""} />
                <span>${esc(t.label)}</span>
              </label>
              <button type="button" class="plan-jump-btn" data-action="${esc(JSON.stringify(t.action))}">Go ↓</button>
            </li>`;
        })
        .join("");
      return `<div class="plan-day"><h4>${esc(day.name)}</h4><ul>${tasks}</ul></div>`;
    })
    .join("");

  return `
    <p class="tagline" style="margin-bottom:6px">Week ${esc(plan.isoWeek)} — resets every Monday. ${focusLine}</p>
    <p class="status-line" style="margin-bottom:14px"><strong>${doneCount}/${plan.totalTasks}</strong> done this week</p>
    <div class="plan-days">${days}</div>`;
}
