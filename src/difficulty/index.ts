/**
 * Difficulty curve.
 *
 * Pure mapping from how far the run has progressed to the three knobs that make
 * the game ramp: world scroll `speed`, obstacle `density`, and pattern
 * `complexity`. No Three.js, no state, no randomness - just a function of one
 * number, so it is trivially testable for monotonicity and bounds.
 *
 * Design decisions (per spec #7):
 *  - INPUT is run distance (world units), not wall-clock time. Distance is the
 *    deterministic quantity the rest of the game already keys on (track z, score),
 *    so a given point in the track always has the same difficulty regardless of
 *    frame rate or pauses. This keeps generation reproducible.
 *  - Each output is BOUNDED and monotonic non-decreasing in distance (never
 *    easier as the run grows), and EASES toward a cap rather than growing without
 *    limit, via a saturating exponential `1 - exp(-distance / scale)`. That
 *    factor `r` runs 0 -> 1 as distance grows, fast at first then flattening.
 *  - speed:      BASE_SPEED .. MAX_SPEED   (units/sec). Starts exactly at the
 *                game's base SPEED so frame 0 is unchanged.
 *  - density:    0 .. 1   (feeds the generator's difficulty arg; higher = more
 *                obstacle-heavy chunks).
 *  - complexity: 0 .. 1   (also feeds the generator; higher = more
 *                lane-shifting / multi-block patterns).
 *
 *  density and complexity are combined into the single [0,1] difficulty argument
 *  the track generator accepts (see `generatorDifficulty`).
 */

/** World scroll speed at the start of a run (units/sec). Mirrors game SPEED. */
export const BASE_SPEED = 20;
/** Hard cap the scroll speed eases toward; never exceeded. */
export const MAX_SPEED = 40;

/**
 * Distance (world units) over which the ramp substantially develops. At this
 * distance the saturating factor reaches ~63%; by ~3x it is ~95%. Chosen so the
 * run noticeably hardens over the first few hundred units without spiking.
 */
const RAMP_SCALE = 1500;

export interface Difficulty {
  /** World scroll speed in units/sec, BASE_SPEED..MAX_SPEED. */
  speed: number;
  /** Obstacle density knob, 0..1. */
  density: number;
  /** Pattern complexity knob, 0..1. */
  complexity: number;
}

/** Saturating ramp factor: 0 at distance 0, easing monotonically toward 1. */
function ramp(distance: number): number {
  const d = Math.max(0, distance);
  return 1 - Math.exp(-d / RAMP_SCALE);
}

/**
 * Map run distance to bounded, monotonic difficulty knobs.
 * Pure: same distance always yields the same result.
 */
export function curve(distance: number): Difficulty {
  const r = ramp(distance);
  return {
    speed: BASE_SPEED + (MAX_SPEED - BASE_SPEED) * r,
    density: r,
    complexity: r,
  };
}

/**
 * Collapse density + complexity into the single [0,1] difficulty value the track
 * generator accepts. Both knobs pull in the same direction (harder), so we use
 * their mean; the result is bounded [0,1] and monotonic in distance.
 */
export function generatorDifficulty(d: Difficulty): number {
  return (d.density + d.complexity) / 2;
}
