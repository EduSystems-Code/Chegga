import { describe, it, expect, beforeEach } from "vitest";
import {
  CLASSIFICATION_ORDER,
  getClassColor,
  isColorblindPalette,
  setColorblindPalette,
} from "../../src/classificationColors";

describe("classification colours", () => {
  beforeEach(() => {
    setColorblindPalette(false); // module-level state — reset between cases
  });

  it("covers the six quality tiers in order", () => {
    expect(CLASSIFICATION_ORDER).toEqual([
      "best",
      "excellent",
      "good",
      "inaccuracy",
      "mistake",
      "blunder",
    ]);
  });

  it("returns the default palette when colour-blind mode is off", () => {
    expect(getClassColor("best")).toBe("#4caf50");
    expect(getClassColor("blunder")).toBe("#e53935");
  });

  it("switches every tier to the blue->orange palette when enabled", () => {
    setColorblindPalette(true);
    expect(isColorblindPalette()).toBe(true);
    expect(getClassColor("best")).toBe("#1565c0");
    expect(getClassColor("blunder")).toBe("#b23a00");
  });

  it("does not throw on an unknown key", () => {
    expect(() => getClassColor("not-a-tier")).not.toThrow();
  });
});
