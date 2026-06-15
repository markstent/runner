import { describe, it, expect } from "vitest";
import {
  generate,
  isClearable,
  LANES,
  ROW_SPACING,
  type Placement,
  type PlacementType,
} from "../../src/track/index.ts";

const TYPES: PlacementType[] = ["obstacle-low", "obstacle-high", "full-block", "coin"];

const DIFFICULTY = 1;

describe("track generation", () => {
  it("generate(seed, difficulty) returns a non-empty deterministic sequence", () => {
    const placements = generate(123, DIFFICULTY);
    expect(Array.isArray(placements)).toBe(true);
    expect(placements.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same seed yields an identical sequence", () => {
    const a = generate(42, DIFFICULTY);
    const b = generate(42, DIFFICULTY);
    expect(a).toEqual(b);
  });

  it("different seeds yield different sequences", () => {
    const a = generate(1, DIFFICULTY);
    const b = generate(2, DIFFICULTY);
    expect(a).not.toEqual(b);
  });

  it("every placement has a valid lane and type, with non-decreasing z", () => {
    const placements = generate(7, DIFFICULTY);
    let lastZ = -Infinity;
    for (const p of placements) {
      expect(LANES).toContain(p.lane);
      expect(TYPES).toContain(p.type);
      // Placements in the same row share a z; z never goes backwards.
      expect(p.z).toBeGreaterThanOrEqual(lastZ);
      lastZ = p.z;
    }
  });

  it("produces obstacles as well as coins", () => {
    const placements = generate(7, DIFFICULTY);
    expect(placements.some((p) => p.type !== "coin")).toBe(true);
    expect(placements.some((p) => p.type === "coin")).toBe(true);
  });
});

describe("fairness validator (isClearable)", () => {
  it("rejects a row that full-blocks every lane", () => {
    const wall: Placement[] = LANES.map((lane) => ({
      lane,
      z: ROW_SPACING,
      type: "full-block" as PlacementType,
    }));
    expect(isClearable(wall)).toBe(false);
  });

  it("rejects forced incompatible lanes with no reaction time", () => {
    // Two adjacent rows (one ROW_SPACING apart) that together leave only
    // mutually unreachable surviving lanes given one-lane-per-row movement.
    const segment: Placement[] = [
      { lane: "center", z: ROW_SPACING, type: "full-block" },
      { lane: "right", z: ROW_SPACING, type: "full-block" },
      // forced to "left". Next row immediately blocks left and center,
      // leaving only "right" which is 2 lanes away and unreachable in 0 gap.
      { lane: "left", z: 2 * ROW_SPACING, type: "full-block" },
      { lane: "center", z: 2 * ROW_SPACING, type: "full-block" },
    ];
    expect(isClearable(segment)).toBe(false);
  });

  it("accepts a segment with an open path and reaction spacing", () => {
    // Blocks are spaced 2 rows apart, giving one reaction row to switch lanes.
    const segment: Placement[] = [
      { lane: "left", z: ROW_SPACING, type: "full-block" },
      { lane: "center", z: 3 * ROW_SPACING, type: "full-block" },
      { lane: "right", z: 5 * ROW_SPACING, type: "full-block" },
    ];
    expect(isClearable(segment)).toBe(true);
  });

  it("rejects adjacent blocks that demand a 2-lane move with no reaction time", () => {
    // left blocked then immediately (1 row apart) right blocked: forced left->...
    // Actually: row1 blocks left+center (forced right), row2 one row later blocks
    // right+center (forced left) - 2 lanes away, 0 reaction rows -> unclearable.
    const segment: Placement[] = [
      { lane: "left", z: ROW_SPACING, type: "full-block" },
      { lane: "center", z: ROW_SPACING, type: "full-block" },
      { lane: "right", z: 2 * ROW_SPACING, type: "full-block" },
      { lane: "center", z: 2 * ROW_SPACING, type: "full-block" },
    ];
    expect(isClearable(segment)).toBe(false);
  });

  it("treats jump/slide obstacles as survivable (only full-block removes a lane)", () => {
    const segment: Placement[] = [
      { lane: "left", z: ROW_SPACING, type: "obstacle-low" },
      { lane: "center", z: ROW_SPACING, type: "obstacle-high" },
      { lane: "right", z: ROW_SPACING, type: "obstacle-low" },
    ];
    expect(isClearable(segment)).toBe(true);
  });

  it("ignores coins entirely", () => {
    const segment: Placement[] = LANES.map((lane) => ({
      lane,
      z: ROW_SPACING,
      type: "coin" as PlacementType,
    }));
    expect(isClearable(segment)).toBe(true);
  });
});

describe("clearability invariant", () => {
  it("every generated track is clearable across many seeds and difficulties", () => {
    const difficulties = [0, 0.25, 0.5, 0.75, 1];
    for (let seed = 0; seed < 200; seed++) {
      for (const d of difficulties) {
        const track = generate(seed, d);
        expect(track.length).toBeGreaterThan(0);
        expect(isClearable(track), `seed=${seed} difficulty=${d}`).toBe(true);
      }
    }
  });

  it("a fixed seed is fully deterministic across difficulties", () => {
    expect(generate(99, 0.5)).toEqual(generate(99, 0.5));
    // different difficulty may legitimately differ; just must be stable per pair
    expect(generate(99, 1)).toEqual(generate(99, 1));
  });
});
