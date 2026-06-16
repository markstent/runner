export type Phase = "start" | "playing" | "gameOver";

export interface GameState {
  phase: Phase;
  /** Total world distance travelled, in world units. */
  distance: number;
}

/** Base/initial world scroll speed in units per second. The difficulty curve
 * (src/difficulty) ramps the live speed above this as the run progresses; tick
 * defaults to it so callers that don't supply a dynamic speed are unchanged. */
export const SPEED = 20;

export function createInitialState(): GameState {
  return { phase: "start", distance: 0 };
}

export function begin(state: GameState): GameState {
  return { ...state, phase: "playing" };
}

export function crash(state: GameState): GameState {
  return { ...state, phase: "gameOver" };
}

// Design choice: restart() goes gameOver -> playing for an immediate replay
// (no detour through the start overlay), the conventional endless-runner UX.
export function restart(state: GameState): GameState {
  return { ...state, phase: "playing", distance: 0 };
}

/**
 * Pure world step: advances distance by `speed * dt` only while playing.
 * `speed` defaults to the base SPEED, so existing callers are unchanged; main.ts
 * passes the difficulty curve's ramped speed for the live dynamic scroll.
 */
export function tick(state: GameState, dt: number, speed: number = SPEED): GameState {
  if (state.phase !== "playing") return state;
  return { ...state, distance: state.distance + speed * dt };
}
