/**
 * Procedural track generation.
 *
 * The track is a deterministic, seedable sequence of placements laid out along
 * the world's negative-Z axis. A placement is a single obstacle or coin pinned
 * to one of three lanes at a fixed Z distance. The world scrolls toward the
 * camera (see render/scene.ts), so larger Z values arrive later.
 *
 * Generation stitches small hand-authored chunks (the catalog) and runs a pure
 * fairness validator so that every produced track is clearable at the world
 * speed. See `isClearable` for the fairness model.
 */

/** The three lanes the player can occupy. */
export type Lane = "left" | "center" | "right";

export const LANES: readonly Lane[] = ["left", "center", "right"] as const;

/** World X position (units) for each lane. The deck is 12 units wide. */
export const LANE_X: Record<Lane, number> = {
  left: -4,
  center: 0,
  right: 4,
};

export type PlacementType =
  | "obstacle-low" // cleared by jumping
  | "obstacle-high" // cleared by sliding
  | "full-block" // blocks the lane entirely; cannot be jumped or slid
  | "coin";

export interface Placement {
  lane: Lane;
  /** Distance along the track, in world units. Strictly increases per row. */
  z: number;
  type: PlacementType;
}

/** Spacing in world units between successive obstacle rows. */
export const ROW_SPACING = 12;

/**
 * Minimum number of rows of breathing room a player needs to react and change
 * lanes between two rows that force a lane change. With ROW_SPACING=12 and
 * SPEED=20 u/s, one row is ~0.6s; we require at least 1 row of reaction gap
 * between forced lane switches, i.e. consecutive blocking rows may not demand
 * incompatible lanes with no time to move.
 */
export const REACTION_ROWS = 1;

/**
 * A chunk is a fixed pattern expressed as rows. Each row lists obstacle/coin
 * cells by lane. Rows are spaced ROW_SPACING apart. A chunk spans `rows.length`
 * rows. Chunks are authored to be individually clearable.
 */
interface Chunk {
  name: string;
  rows: RowSpec[];
}

/** One row of a chunk: a partial map of lane -> type. Empty = open lane. */
type RowSpec = Partial<Record<Lane, PlacementType>>;

/**
 * The chunk catalog. Each chunk is individually fair (at least one open path,
 * with reaction spacing). Coins are placed on open lanes to reward weaving.
 */
const CATALOG: Chunk[] = [
  {
    name: "breather",
    rows: [{ center: "coin" }, {}, { center: "coin" }],
  },
  {
    name: "low-gate-center",
    rows: [{ center: "obstacle-low", left: "coin" }, {}, { center: "coin" }],
  },
  {
    name: "high-gate-center",
    rows: [{ center: "obstacle-high", right: "coin" }, {}, { left: "coin" }],
  },
  {
    name: "side-block-weave",
    // full-block on the left forces center/right; coins reward the open side.
    rows: [{ left: "full-block", right: "coin" }, {}, { center: "coin" }],
  },
  {
    name: "double-side-block",
    // blocks left and right on the same row; center stays open.
    rows: [{ left: "full-block", right: "full-block" }, { center: "coin" }, {}],
  },
  {
    name: "low-high-combo",
    // a low obstacle then a high obstacle on center, both individually clearable,
    // separated by an open row for reaction time.
    rows: [{ center: "obstacle-low" }, {}, { center: "obstacle-high" }, {}, { center: "coin" }],
  },
  {
    name: "lane-shift",
    // full-block center forces a shift to a side; next blocking row sits on a
    // side, leaving the opposite side open. Reaction row in between.
    rows: [{ center: "full-block", left: "coin" }, {}, { right: "full-block", left: "coin" }, {}, { center: "coin" }],
  },
];

/** Number of chunks to stitch per generated track (>=2 minutes of run). */
const CHUNK_COUNT = 64;

/**
 * Deterministically generate a clearable sequence of placements for the given
 * seed and difficulty. Same (seed, difficulty) always yields an identical,
 * fair sequence.
 *
 * Difficulty (0..1) biases chunk selection toward busier chunks but never
 * produces an unclearable track: each appended chunk is validated against the
 * accumulated tail before being accepted.
 */
export function generate(seed: number, difficulty: number): Placement[] {
  const rng = makeRng(seed);
  const d = clamp01(difficulty);
  const placements: Placement[] = [];
  let z = 0;

  for (let c = 0; c < CHUNK_COUNT; c++) {
    const chunk = pickChunk(rng, d);
    const rows = chunkRows(chunk, z);
    // Validate the accumulated track *including* this candidate stays clearable.
    const candidate = placements.concat(rows);
    if (isClearable(candidate)) {
      placements.push(...rows);
      z += chunk.rows.length * ROW_SPACING;
    } else {
      // Fall back to the guaranteed-open breather chunk; it never breaks fairness.
      const safe = chunkRows(CATALOG[0], z);
      placements.push(...safe);
      z += CATALOG[0].rows.length * ROW_SPACING;
    }
  }

  return placements;
}

/** Materialize a chunk's rows into absolute-Z placements starting at baseZ. */
function chunkRows(chunk: Chunk, baseZ: number): Placement[] {
  const out: Placement[] = [];
  chunk.rows.forEach((row, i) => {
    const z = baseZ + (i + 1) * ROW_SPACING;
    for (const lane of LANES) {
      const type = row[lane];
      if (type) out.push({ lane, z, type });
    }
  });
  return out;
}

/** Difficulty-biased deterministic chunk pick. */
function pickChunk(rng: () => number, difficulty: number): Chunk {
  // Bias: low difficulty favours early (calmer) chunks; high difficulty favours
  // later (busier) chunks. Implemented by skewing a uniform draw.
  const u = rng();
  const skewed = Math.pow(u, 1 - 0.6 * difficulty);
  const idx = Math.min(CATALOG.length - 1, Math.floor(skewed * CATALOG.length));
  return CATALOG[idx];
}

/**
 * Pure fairness predicate over a placement sequence.
 *
 * "Clearable" means: stepping through the rows in z-order, there is always at
 * least one lane the player can be in at each blocking row, AND the player can
 * physically reach a surviving lane in time. Concretely:
 *
 *  - A lane is *survivable* at a row if it has no full-block. (obstacle-low and
 *    obstacle-high are survivable because the player can jump/slide; coins and
 *    empty cells are survivable.)
 *  - A row is *passable* if at least one lane is survivable.
 *  - Reaction spacing: the player can move one lane per row. Between two
 *    consecutive blocking rows there must be a reachable surviving lane within
 *    REACTION_ROWS of lateral movement. We track the set of lanes the player
 *    could be in and propagate it forward; if it ever becomes empty the track
 *    is unclearable.
 *
 * Coins never affect clearability. The predicate is total and side-effect free.
 */
export function isClearable(placements: Placement[]): boolean {
  // Group obstacle placements by row (rows keyed by z). Coins are ignored.
  const rows = new Map<number, Set<Lane>>(); // z -> set of full-blocked lanes
  for (const p of placements) {
    if (p.type === "coin") continue;
    if (p.type !== "full-block") continue; // only full-block removes a lane
    let set = rows.get(p.z);
    if (!set) {
      set = new Set<Lane>();
      rows.set(p.z, set);
    }
    set.add(p.lane);
  }

  const zsSorted = [...rows.keys()].sort((a, b) => a - b);

  // Reachable lanes the player could occupy; starts as all lanes.
  let reachable = new Set<Lane>(LANES);

  let prevZ: number | null = null;
  for (const z of zsSorted) {
    const blocked = rows.get(z)!;

    // Survivable lanes at this row.
    const survivable = LANES.filter((l) => !blocked.has(l));
    if (survivable.length === 0) return false; // whole row blocked

    // How many rows of reaction time since the previous blocking row.
    const gapRows =
      prevZ === null ? Infinity : Math.max(0, Math.round((z - prevZ) / ROW_SPACING) - 1);
    const moveBudget = gapRows >= REACTION_ROWS ? Infinity : gapRows;

    // From the current reachable set, lanes we can move to within moveBudget.
    const next = new Set<Lane>();
    for (const s of survivable) {
      for (const r of reachable) {
        if (laneDistance(r, s) <= moveBudget) {
          next.add(s);
          break;
        }
      }
    }
    if (next.size === 0) return false; // no surviving lane reachable in time

    reachable = next;
    prevZ = z;
  }

  return true;
}

/** Lateral distance in lanes between two lanes (0, 1, or 2). */
function laneDistance(a: Lane, b: Lane): number {
  const idx = (l: Lane) => LANES.indexOf(l);
  return Math.abs(idx(a) - idx(b));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Small deterministic PRNG (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
