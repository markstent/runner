export type Phase = "start" | "playing" | "gameOver";

export interface GameState {
  phase: Phase;
  /** Total world distance travelled, in world units. */
  distance: number;
}

/** World scroll speed in units per second while playing. */
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

/** Pure world step: advances distance by SPEED * dt only while playing. */
export function tick(state: GameState, dt: number): GameState {
  if (state.phase !== "playing") return state;
  return { ...state, distance: state.distance + SPEED * dt };
}
