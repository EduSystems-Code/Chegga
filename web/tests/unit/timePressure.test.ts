import { describe, it, expect } from "vitest";
import { bandFor } from "../../src/timePressure";

describe("bandFor", () => {
  it("returns undefined when the clock is unknown", () => {
    expect(bandFor(undefined, "600")).toBeUndefined();
  });

  it("returns undefined for correspondence games (no meaningful base)", () => {
    expect(bandFor(60, "1/259200")).toBeUndefined();
  });

  it("buckets by fraction of base time remaining", () => {
    expect(bandFor(30, "600")).toBe("critical (<10% time left)"); // 0.05
    expect(bandFor(120, "600")).toBe("low (10-30%)"); // 0.20
    expect(bandFor(300, "600")).toBe("comfortable (30-70%)"); // 0.50
    expect(bandFor(500, "600")).toBe("plenty (>70%)"); // 0.83
  });

  it("treats the band boundary as lower-inclusive", () => {
    expect(bandFor(60, "600")).toBe("low (10-30%)"); // exactly 0.10 -> low, not critical
  });
});
