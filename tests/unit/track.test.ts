import { describe, it, expect } from "vitest";
import {
  generate,
  isClearable,
  nextBatch,
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

describe("nextBatch (endless append)", () => {
  it("is deterministic for the same (seed, batchIndex)", () => {
    const a = nextBatch(1337, 3, 0.5, 0);
    const b = nextBatch(1337, 3, 0.5, 0);
    expect(a).toEqual(b);
  });

  it("offsets every placement so the batch starts at/after zOffset", () => {
    const offset = 1000;
    const base = nextBatch(1337, 0, 0.5, 0);
    const shifted = nextBatch(1337, 0, 0.5, offset);
    // Same content, all z values translated by exactly `offset`.
    expect(shifted.map((p) => p.z)).toEqual(base.map((p) => p.z + offset));
    expect(Math.min(...shifted.map((p) => p.z))).toBeGreaterThanOrEqual(offset);
  });

  it("a batch and the concatenation of consecutive batches is clearable", () => {
    let z = 0;
    let combined: Placement[] = [];
    for (let i = 0; i < 5; i++) {
      const batch = nextBatch(1337, i, 0.5, z);
      expect(isClearable(batch), `batch ${i} alone`).toBe(true);
      combined = combined.concat(batch);
      z = batch[batch.length - 1].z + ROW_SPACING;
    }
    expect(isClearable(combined)).toBe(true);
  });
});

describe("cross-batch seam fairness", () => {
  // The first row of every batch must leave all lanes open (no full-block), so
  // that however the previous batch ended, the player always has a reachable
  // surviving lane at the join.
  function firstRowZ(batch: Placement[]): number {
    return Math.min(...batch.map((p) => p.z));
  }

  it("every nextBatch begins with an all-lanes-open row (no full-block) for any (seed, batchIndex)", () => {
    for (let seed = 0; seed < 40; seed++) {
      for (let i = 0; i < 6; i++) {
        const batch = nextBatch(seed, i, 0.5, 0);
        const z0 = firstRowZ(batch);
        const firstRowBlocks = batch.filter((p) => p.z === z0 && p.type === "full-block");
        expect(firstRowBlocks, `seed=${seed} batchIndex=${i} first row has a full-block`).toEqual(
          [],
        );
      }
    }
  });

  it("an adversarial forced-lane tail concatenated with a fresh batch stays clearable", () => {
    // (seed=0, batchIndex=1) produces a batch whose first row, BEFORE this fix,
    // full-blocks left+right (leaving only center). Build a previous-batch tail
    // that ends forcing the player into "left" (final row blocks center+right),
    // then join the fresh batch one ROW_SPACING later (zero reaction rows).
    // Without the breather lead-in this seam is unclearable: the player is stuck
    // on left, the next row only leaves center open, and there is no time to move.
    const tailEndZ = 5 * ROW_SPACING;
    const tail: Placement[] = [
      { lane: "center", z: tailEndZ, type: "full-block" },
      { lane: "right", z: tailEndZ, type: "full-block" },
    ];
    const seamOffset = tailEndZ; // new batch's first row lands at seamOffset + ROW_SPACING
    const fresh = nextBatch(0, 1, 0.5, seamOffset);
    // Sanity: the seam really is one ROW_SPACING apart.
    expect(firstRowZ(fresh)).toBe(tailEndZ + ROW_SPACING);
    expect(isClearable(tail.concat(fresh))).toBe(true);
  });

  it("consecutive batches joined one ROW_SPACING apart are clearable across many seed/index pairs", () => {
    let combos = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (let i = 0; i < 4; i++) {
        const a = nextBatch(seed, i, 0.5, 0);
        const aLastZ = Math.max(...a.map((p) => p.z));
        // Join the next batch at the tightest seam: one ROW_SPACING after a's last row.
        const b = nextBatch(seed, i + 1, 0.5, aLastZ);
        expect(firstRowZ(b)).toBe(aLastZ + ROW_SPACING);
        expect(isClearable(a.concat(b)), `seed=${seed} join ${i}->${i + 1}`).toBe(true);
        combos++;
      }
    }
    expect(combos).toBeGreaterThanOrEqual(100);
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

  it("a fixed seed is fully deterministic, independent of difficulty", () => {
    expect(generate(99, 0.5)).toEqual(generate(99, 0.5));
    // difficulty is currently ignored for selection (#7 will consume it), so the
    // same seed yields the same track regardless of the difficulty argument.
    expect(generate(99, 1)).toEqual(generate(99, 0));
  });
});
