import { describe, it, expect } from "vitest";
import {
  curve,
  generatorDifficulty,
  BASE_SPEED,
  MAX_SPEED,
} from "../../src/difficulty/index.ts";

// Distances spanning the whole ramp, from start to deep into saturation.
const SAMPLES = [0, 50, 100, 250, 500, 1000, 1500, 3000, 6000, 20000, 100000];

describe("difficulty curve", () => {
  it("starts at base speed and ramps toward (never above) the cap", () => {
    expect(curve(0).speed).toBe(BASE_SPEED);
    const far = curve(100_000).speed;
    expect(far).toBeGreaterThan(curve(0).speed);
    expect(far).toBeLessThanOrEqual(MAX_SPEED);
  });

  it("speed is monotonic non-decreasing in distance and stays within bounds", () => {
    let prev = -Infinity;
    for (const d of SAMPLES) {
      const s = curve(d).speed;
      expect(s).toBeGreaterThanOrEqual(BASE_SPEED);
      expect(s).toBeLessThanOrEqual(MAX_SPEED);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("density is monotonic non-decreasing, bounded [0,1], starts at 0", () => {
    expect(curve(0).density).toBe(0);
    let prev = -Infinity;
    for (const d of SAMPLES) {
      const v = curve(d).density;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("complexity is monotonic non-decreasing, bounded [0,1], starts at 0", () => {
    expect(curve(0).complexity).toBe(0);
    let prev = -Infinity;
    for (const d of SAMPLES) {
      const v = curve(d).complexity;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("eases toward the cap: deep distance is near-but-not-over MAX_SPEED", () => {
    const far = curve(100_000).speed;
    expect(far).toBeGreaterThan(MAX_SPEED - 0.01);
    expect(far).toBeLessThanOrEqual(MAX_SPEED);
  });

  it("is pure: same distance yields identical output", () => {
    expect(curve(777)).toEqual(curve(777));
  });

  it("generatorDifficulty collapses knobs into [0,1], monotonic in distance", () => {
    let prev = -Infinity;
    for (const d of SAMPLES) {
      const g = generatorDifficulty(curve(d));
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});
