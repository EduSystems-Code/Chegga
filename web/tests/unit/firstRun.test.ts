import { describe, it, expect } from "vitest";
import { shouldShowTutorial, TUTORIAL_KEY } from "../../src/firstRun";

function storageOf(items: Record<string, string>) {
  const keys = Object.keys(items);
  return {
    getItem: (k: string) => items[k] ?? null,
    key: (i: number) => keys[i] ?? null,
    length: keys.length,
  };
}

const fresh = { search: "", hashUsername: undefined };

describe("shouldShowTutorial", () => {
  it("shows it to a browser that has never used the app", () => {
    expect(shouldShowTutorial({ ...fresh, storage: storageOf({}) })).toBe(true);
  });

  it("ignores the settings the app writes on every load", () => {
    const passive = storageOf({
      "chegga-web:board-theme": "harbor",
      "chegga-web:piece-set": "modern",
      "chegga-web:sound-enabled": "1",
      "chegga-web:today:guest": "{}",
    });
    expect(shouldShowTutorial({ ...fresh, storage: passive })).toBe(true);
  });

  it("does not show it twice", () => {
    expect(shouldShowTutorial({ ...fresh, storage: storageOf({ [TUTORIAL_KEY]: "done" }) })).toBe(false);
    expect(shouldShowTutorial({ ...fresh, storage: storageOf({ [TUTORIAL_KEY]: "skipped" }) })).toBe(false);
  });

  it("treats any sign of use as a returning visitor", () => {
    for (const key of [
      "chegga-web:last-username",
      "chegga-web:bot-game-in-progress",
      "chegga-web:card-collapsed:play-section",
      "chegga-web:bot-stats:guest",
      "chegga-web:puzzle-progress:someone",
      "chegga-web:redemptions:someone",
    ]) {
      expect(shouldShowTutorial({ ...fresh, storage: storageOf({ [key]: "1" }) }), key).toBe(false);
    }
  });

  it("skips it for a shared link that already names an account", () => {
    expect(shouldShowTutorial({ search: "", hashUsername: "MichaelBottega", storage: storageOf({}) })).toBe(false);
  });

  it("lets the address force it on or off", () => {
    const returning = storageOf({ [TUTORIAL_KEY]: "done", "chegga-web:last-username": "x" });
    expect(shouldShowTutorial({ ...fresh, search: "?tutorial=1", storage: returning })).toBe(true);
    expect(shouldShowTutorial({ ...fresh, search: "?tutorial=0", storage: storageOf({}) })).toBe(false);
  });

  it("does not show it when storage is blocked, since it could never remember", () => {
    expect(shouldShowTutorial({ ...fresh, storage: null })).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      key: () => null,
      length: 0,
    };
    expect(shouldShowTutorial({ ...fresh, storage: throwing })).toBe(false);
  });
});
