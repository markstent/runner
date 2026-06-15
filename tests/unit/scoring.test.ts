import { describe, it, expect } from "vitest";
import { scoreFor, COIN_VALUE, createHighScore } from "../../src/scoring/index.ts";

describe("scoreFor", () => {
  it("floors the distance when there are no coins", () => {
    expect(scoreFor(100.7, 0)).toBe(100);
  });

  it("adds COIN_VALUE per coin on top of distance", () => {
    expect(scoreFor(0, 3)).toBe(3 * COIN_VALUE);
  });

  it("combines floored distance with coin bonus", () => {
    expect(scoreFor(42.9, 2)).toBe(42 + 2 * COIN_VALUE);
  });
});

/** Minimal in-memory storage implementing the injected { getItem, setItem } seam. */
function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string): string | null => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string): void => {
      data.set(k, v);
    },
  };
}

/** A storage whose every access throws, simulating private mode / disabled storage. */
function throwingStorage() {
  return {
    getItem: (): string | null => {
      throw new Error("storage unavailable");
    },
    setItem: (): void => {
      throw new Error("storage unavailable");
    },
  };
}

describe("createHighScore", () => {
  const KEY = "test:highscore";

  it("get() defaults to 0 when storage is empty", () => {
    const hs = createHighScore(fakeStorage(), KEY);
    expect(hs.get()).toBe(0);
  });

  it("submit() stores a new best and returns it", () => {
    const hs = createHighScore(fakeStorage(), KEY);
    expect(hs.submit(150)).toBe(150);
    expect(hs.get()).toBe(150);
  });

  it("submit() of a lower score keeps the previous best", () => {
    const hs = createHighScore(fakeStorage(), KEY);
    hs.submit(200);
    expect(hs.submit(50)).toBe(200);
    expect(hs.get()).toBe(200);
  });

  it("persists across instances via the injected storage (round-trip)", () => {
    const storage = fakeStorage();
    createHighScore(storage, KEY).submit(300);
    const fresh = createHighScore(storage, KEY);
    expect(fresh.get()).toBe(300);
  });

  it("degrades gracefully when storage throws: get() returns 0", () => {
    const hs = createHighScore(throwingStorage(), KEY);
    expect(hs.get()).toBe(0);
  });

  it("degrades gracefully when storage throws: submit() returns the max so far and does not throw", () => {
    const hs = createHighScore(throwingStorage(), KEY);
    expect(hs.submit(120)).toBe(120);
    expect(hs.submit(90)).toBe(120);
  });
});
