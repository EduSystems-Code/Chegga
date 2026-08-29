// Chegga Web — a deterministic 7-day study plan
//
// today.ts gives one set for *today*; this is the week around it, so a
// visitor pushing for a rating goal can see the whole arc. Fully
// rule-based: the plan is a fixed weekly skeleton, re-weighted toward
// whichever skill category skillProfile.ts flagged as weakest, with
// concrete numbers filled in from the visitor's puzzle rating and worst
// opening. Checkbox state is per ISO-week in localStorage, so it resets
// on its own every Monday.

import type { SkillCategoryId } from "./skillProfile";

export type PlanActionKind = "puzzle" | "themed" | "drill" | "openings" | "vision" | "play" | "redemption";

export interface PlanTask {
  id: string; // stable within a week: `${dayIndex}-${slot}`
  label: string;
  action: { kind: PlanActionKind; phase?: "opening" | "middlegame" | "endgame" };
}

export interface PlanDay {
  name: string;
  tasks: PlanTask[];
}

export interface WeeklyPlan {
  isoWeek: string; // "2026-W35"
  focus: SkillCategoryId | null;
  days: PlanDay[];
  totalTasks: number;
}

export interface WeeklyPlanInput {
  focus: SkillCategoryId | null;
  puzzleRating: number;
  weakestOpeningName?: string;
  botElo: number; // suggested sparring strength
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO-8601 week string, local time. Same value all week, changes Monday. */
export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function ratingBand(r: number): string {
  const lo = Math.round((r - 100) / 50) * 50;
  return `${lo}–${lo + 200}`;
}

const FOCUS_BOOSTER: Record<SkillCategoryId, PlanTask["action"] & { label: string }> = {
  opening: { kind: "openings", label: "10 min: quiz yourself on your own main-line opening moves" },
  middlegame: { kind: "puzzle", phase: "middlegame", label: "10 extra tactics from your own middlegame mistakes" },
  endgame: { kind: "drill", phase: "endgame", label: "2 extra endgame technique drills" },
  timeManagement: { kind: "vision", label: "10 vision-trainer positions on a short timer" },
};

export function buildWeeklyPlan(input: WeeklyPlanInput): WeeklyPlan {
  const band = ratingBand(input.puzzleRating);
  const openingLabel = input.weakestOpeningName
    ? `Opening review: your worst line ("${input.weakestOpeningName}")`
    : "Opening review: your most-played line in the repertoire table";

  // Fixed weekly skeleton.
  const skeleton: PlanDay[] = DAY_NAMES.map((name, i) => {
    const tasks: PlanTask[] = [];
    tasks.push({ id: `${i}-a`, label: `15 themed puzzles at ${band}, full lines`, action: { kind: "themed" } });
    if (i === 0 || i === 3) tasks.push({ id: `${i}-b`, label: "3 endgame technique drills", action: { kind: "drill", phase: "endgame" } });
    if (i === 1 || i === 4) tasks.push({ id: `${i}-b`, label: `1 slower game vs a ~${input.botElo} bot in a line you struggle with`, action: { kind: "play" } });
    if (i === 2) tasks.push({ id: `${i}-b`, label: "Review 5 of your worst losses (Redeem a loss card)", action: { kind: "redemption" } });
    if (i === 5) tasks.push({ id: `${i}-b`, label: openingLabel, action: { kind: "openings" } });
    if (i === 6) tasks.push({ id: `${i}-b`, label: "Light day: 10 vision-trainer positions", action: { kind: "vision" } });
    return { name, tasks };
  });

  // Focus booster on 3 spread-out days.
  if (input.focus) {
    const b = FOCUS_BOOSTER[input.focus];
    for (const dayIdx of [0, 2, 4]) {
      skeleton[dayIdx].tasks.push({ id: `${dayIdx}-focus`, label: b.label, action: { kind: b.kind, phase: b.phase } });
    }
  }

  const totalTasks = skeleton.reduce((s, d) => s + d.tasks.length, 0);
  return { isoWeek: isoWeek(), focus: input.focus, days: skeleton, totalTasks };
}

// --- per-week checkbox persistence ---

const KEY = "chegga:weekplan:";

export function getDoneTasks(user: string, week: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY + week + ":" + user);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function setTaskDone(user: string, week: string, taskId: string, done: boolean): Set<string> {
  const set = getDoneTasks(user, week);
  if (done) set.add(taskId);
  else set.delete(taskId);
  try {
    localStorage.setItem(KEY + week + ":" + user, JSON.stringify([...set]));
  } catch {
    /* storage unavailable — checkbox still updates in the DOM for this session */
  }
  return set;
}
