import { describe, it, expect } from "vitest";
import {
  parseTimeControlBaseSeconds,
  clockSecondsFromComment,
  clocksByFen,
} from "../../src/clockParser";

describe("parseTimeControlBaseSeconds", () => {
  it("returns the base for a plain second count", () => {
    expect(parseTimeControlBaseSeconds("600")).toBe(600);
  });

  it("ignores the increment", () => {
    expect(parseTimeControlBaseSeconds("180+2")).toBe(180);
  });

  it("returns undefined for correspondence/daily controls", () => {
    expect(parseTimeControlBaseSeconds("1/259200")).toBeUndefined();
  });

  it("returns undefined for empty or non-numeric input", () => {
    expect(parseTimeControlBaseSeconds("")).toBeUndefined();
    expect(parseTimeControlBaseSeconds("abc")).toBeUndefined();
  });
});

describe("clockSecondsFromComment", () => {
  it("parses H:MM:SS from a %clk annotation", () => {
    expect(clockSecondsFromComment("[%clk 0:03:00]")).toBe(180);
    expect(clockSecondsFromComment("[%clk 1:00:00]")).toBe(3600);
  });

  it("keeps fractional seconds", () => {
    expect(clockSecondsFromComment("[%clk 0:00:12.7]")).toBeCloseTo(12.7, 5);
  });

  it("returns undefined when there is no %clk", () => {
    expect(clockSecondsFromComment("a normal comment")).toBeUndefined();
  });
});

describe("clocksByFen", () => {
  it("maps each FEN to its remaining seconds and skips clock-less comments", () => {
    const map = clocksByFen([
      { fen: "fen-A", comment: "[%clk 0:05:00]" },
      { fen: "fen-B", comment: "no clock here" },
      { fen: "fen-C", comment: "[%clk 0:04:30]" },
    ]);
    expect(map.get("fen-A")).toBe(300);
    expect(map.has("fen-B")).toBe(false);
    expect(map.get("fen-C")).toBe(270);
  });
});
