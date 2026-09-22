import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { ExportedData, GameRecord, MoveAnalysisRecord } from "../../src/db";
import { computeConsistency } from "../../src/consistencyMetrics";
import { renderConsistency } from "../../src/consistencyView";
import { computeBlunderRate } from "../../src/blunderRate";
import { renderBlunderRate } from "../../src/blunderRateView";
import { findThrownGames } from "../../src/convertTheWin";
import { renderThrownGames } from "../../src/convertTheWinView";
import { averageFeatures, computeRoadToTarget } from "../../src/roadTo2000";
import { renderRoadToTarget } from "../../src/roadTo2000View";
import { buildWeeklyPlan } from "../../src/weeklyPlan";
import { renderWeeklyPlan } from "../../src/weeklyPlanView";
import { estimateStrength } from "../../src/strengthEstimate";
import { computeProfile } from "../../src/profileService";

// The bundled demo dataset exists so a first-time visitor isn't shown an
// empty app. That only works if the fixture actually clears every growth
// card's data gate — each card hides itself when its own compute function
// returns nothing, so a fixture that is merely *valid* can still produce a
// blank page. These tests run the real compute + render functions over the
// real shipped file, which is the check that was missing when the growth
// cards were first written (they had never been run against real data).
//
// Regenerate the fixture with: node scripts/generate-demo-data.mjs

const data = JSON.parse(
  readFileSync(new URL("../../public/demo-data.json", import.meta.url), "utf8"),
) as ExportedData;

const games: GameRecord[] = data.games;
const analyzedGames = games.filter((g) => g.analyzed);
const byId = new Map(games.map((g) => [g.chessComUuid, g]));
const ownMoves: MoveAnalysisRecord[] = data.moveAnalysis.filter(
  (m) => m.sideToMove === byId.get(m.gameId)?.userColor,
);

/** Real content = not empty, and not an "add more games" placeholder. */
function looksSubstantial(html: string) {
  expect(html.length).toBeGreaterThan(120);
  expect(html).not.toMatch(/not enough data|no data|nothing yet/i);
}

describe("bundled demo dataset", () => {
  it("is a v4 export with games, analyses and sync state", () => {
    expect(data.formatVersion).toBe(4);
    expect(games.length).toBeGreaterThanOrEqual(10);
    expect(data.syncState.length).toBeGreaterThan(0);
    expect(ownMoves.length).toBeGreaterThan(100);
  });

  it("is entirely one fabricated visitor's data", () => {
    expect(new Set(games.map((g) => g.username))).toEqual(new Set(["chegga-demo"]));
    expect(games.every((g) => g.analyzed)).toBe(true);
  });

  it("every analysis record belongs to a game in the file", () => {
    for (const m of data.moveAnalysis) expect(byId.has(m.gameId)).toBe(true);
  });
});

describe("growth cards render real content against the demo dataset", () => {
  it("Road to a target rating: produces a strength estimate and ranked factors", () => {
    const features = averageFeatures(analyzedGames, ownMoves);
    expect(features).toBeDefined();

    const estimates = analyzedGames
      .map((g) => estimateStrength(g, ownMoves.filter((m) => m.gameId === g.chessComUuid)))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
    expect(estimates.length).toBeGreaterThan(0);

    const avg = estimates.reduce((s, e) => s + e.estimatedRating, 0) / estimates.length;
    const road = computeRoadToTarget(features!, avg, 2000);
    // A card with no factors renders as an empty list — the player would be
    // told nothing at all.
    expect(road.factors.length).toBeGreaterThan(0);
    expect(road.explainedPoints).toBeGreaterThan(0);
    looksSubstantial(renderRoadToTarget(road));
  });

  it("This week's plan: builds a full 7-day plan", () => {
    const plan = buildWeeklyPlan({
      focus: "middlegame",
      puzzleRating: 1200,
      weakestOpeningName: analyzedGames[0].openingName,
      botElo: 1400,
    });
    expect(plan.days.length).toBe(7);
    looksSubstantial(renderWeeklyPlan(plan, new Set()));
  });

  it("Blunder rate over time: plots at least two months and a trend", () => {
    const summary = computeBlunderRate(analyzedGames, ownMoves);
    expect(summary).toBeDefined();
    // One month is a dot, not a trend — the chart needs at least two.
    expect(summary!.monthly.length).toBeGreaterThanOrEqual(2);
    expect(summary!.trend).toBeDefined();
    expect(summary!.blundersPer100).toBeGreaterThan(0);
    looksSubstantial(renderBlunderRate(summary!));
  });

  it("Consistency & tilt: clears the 10-game floor and names a real pattern", () => {
    const c = computeConsistency(games, ownMoves);
    expect(c).toBeDefined();
    expect(c!.bySessionDepth.length).toBe(4);
    // The fixture scripts a five-loss streak so the card gives real advice
    // instead of its "no strong pattern" fallback.
    expect(c!.longestLossStreak).toBeGreaterThanOrEqual(5);
    expect(c!.recommendations.join(" ")).toMatch(/losing streak/i);
    looksSubstantial(renderConsistency(c!));
  });

  it("Games you didn't convert: finds a game thrown from a winning position", () => {
    const thrown = findThrownGames(analyzedGames, ownMoves);
    expect(thrown.length).toBeGreaterThan(0);
    for (const t of thrown) {
      expect(t.peakEvalPawns).toBeGreaterThanOrEqual(2.5);
      expect(t.result === "loss" || t.result === "draw").toBe(true);
    }
    looksSubstantial(renderThrownGames(thrown));
  });

  it("Your profile: aggregates openings, phases and time pressure", () => {
    const profile = computeProfile(analyzedGames, ownMoves);
    expect(profile.gamesAnalyzed).toBe(analyzedGames.length);
    expect(profile.avgCentipawnLoss).toBeGreaterThan(0);
    expect(profile.topOpenings.length).toBeGreaterThan(1);
    expect(profile.classificationCounts.blunder).toBeGreaterThan(0);
    expect(Object.keys(profile.phaseAvgCpLoss).length).toBeGreaterThan(1);
    expect(profile.monthlyTrend.length).toBeGreaterThanOrEqual(2);
    // Time-pressure banding only works if the fixture carries real clocks.
    expect(profile.timePressureBreakdown.some((b) => b.moves > 0)).toBe(true);
  });
});
