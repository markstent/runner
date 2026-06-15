/**
 * Pure player movement state machine for the runner.
 *
 * This module has NO Three.js dependency. It is the primary seam between game
 * logic and rendering: `step(state, intent, dt)` advances an immutable player
 * state, and `pose(state)` projects it to a small render-facing pose
 * (continuous x / y / squash) that the renderer maps onto an avatar mesh. The
 * rigged-avatar swap (#12) consumes `pose`, so it can land without touching this
 * file.
 *
 * Transition model
 * ----------------
 * - Lanes are DISCRETE ("left" | "center" | "right"), reusing the track's Lane
 *   type and LANE_X positions. A move intent retargets one lane at a time
 *   (never two at once) and the lateral position TWEENS from the old lane to the
 *   new one over LANE_TWEEN_SECONDS via `laneT` (0..1). `lane` is the *target*
 *   lane; `fromLane` is where the tween started. A new move intent is accepted
 *   only when the current tween has completed (laneT >= 1), so moves do not
 *   stack. Edge lanes clamp: a left intent in the left lane is a no-op.
 * - Vertical is a small state machine: "grounded" | "jumping" | "sliding".
 *   A jump follows a fixed parabolic arc of height JUMP_HEIGHT over
 *   JUMP_SECONDS, then auto-returns to grounded. A slide lowers/squashes the
 *   avatar for SLIDE_SECONDS, then auto-returns. You cannot jump while sliding
 *   or slide while jumping; such an intent is buffered (see below).
 * - Input buffering: a jump/slide intent that cannot act on the current frame
 *   (because the player is airborne or sliding) is remembered for up to
 *   BUFFER_SECONDS and replayed automatically the moment the player is grounded
 *   again. Lateral move intents are NOT buffered (they are cheap to re-press and
 *   buffering them fights the player).
 * - Coyote time: a jump pressed during the FINAL COYOTE_SECONDS of a slide is
 *   forgiven - it cancels the remaining slide and jumps immediately, instead of
 *   waiting for the slide to fully auto-return. (Earlier in the slide a jump is
 *   buffered instead; see above.) This is the "a jump shortly after leaving the
 *   grounded state still jumps" forgiveness window: the slide is the grounded
 *   action, and the window straddles its end so a slightly-early press lands.
 *
 * All transitions happen on the SAME frame the intent arrives (movement reacts
 * immediately), satisfying the spec's "reacts on the same frame as input".
 */
import { LANE_X, LANES, type Lane } from "../track/index.ts";

/** A single movement intent consumed by `step`. `null` means "no input". */
export type Intent = "left" | "right" | "jump" | "slide";

export type VerticalMode = "grounded" | "jumping" | "sliding";

export interface PlayerState {
  /** Target lane the player occupies / is moving toward. */
  lane: Lane;
  /** Lane the active lateral tween started from (equals `lane` when settled). */
  fromLane: Lane;
  /** Lateral tween progress 0..1; 1 means the player has arrived in `lane`. */
  laneT: number;
  /** Vertical state machine mode. */
  mode: VerticalMode;
  /** Seconds elapsed in the current jump or slide (0 while grounded). */
  vt: number;
  /** A jump/slide intent buffered for replay, or null. */
  buffered: Exclude<Intent, "left" | "right"> | null;
  /** Seconds the buffered intent has waited; it expires after BUFFER_SECONDS. */
  bufferAge: number;
}

/** Seconds to tween laterally between adjacent lanes. */
export const LANE_TWEEN_SECONDS = 0.12;
/** Jump arc duration (rise + fall). */
export const JUMP_SECONDS = 0.6;
/** Peak jump height in world units. */
export const JUMP_HEIGHT = 2.4;
/** Slide duration before auto-returning to grounded. */
export const SLIDE_SECONDS = 0.5;
/** How long a non-actionable jump/slide intent is held for replay. */
export const BUFFER_SECONDS = 0.15;
/** Forgiveness window after leaving grounded during which a jump still fires. */
export const COYOTE_SECONDS = 0.1;

/** Render-facing projection of the player state. */
export interface PlayerPose {
  /** Continuous world X (lerped between LANE_X lanes during a tween). */
  x: number;
  /** Vertical offset in world units (>0 only mid-jump). */
  y: number;
  /** Vertical scale 0..1; <1 while sliding (a squash for the placeholder). */
  squash: number;
}

export function createInitialPlayer(): PlayerState {
  return {
    lane: "center",
    fromLane: "center",
    laneT: 1,
    mode: "grounded",
    vt: 0,
    buffered: null,
    bufferAge: 0,
  };
}

/** Index of a lane within LANES (0=left, 1=center, 2=right). */
function laneIndex(lane: Lane): number {
  return LANES.indexOf(lane);
}

/** The lane one step in `dir` from `lane`, clamped at the edges. */
function shiftLane(lane: Lane, dir: -1 | 1): Lane {
  const i = Math.max(0, Math.min(LANES.length - 1, laneIndex(lane) + dir));
  return LANES[i];
}

/**
 * Advance the player one frame. Pure: returns a new state, never mutates input.
 */
export function step(state: PlayerState, intent: Intent | null, dt: number): PlayerState {
  let { lane, fromLane, laneT, mode, vt, buffered, bufferAge } = state;

  // --- Lateral movement ---------------------------------------------------
  // Advance an in-flight tween first so a freshly arrived player can re-move.
  if (laneT < 1) {
    laneT = Math.min(1, laneT + dt / LANE_TWEEN_SECONDS);
  }
  if ((intent === "left" || intent === "right") && laneT >= 1) {
    const target = shiftLane(lane, intent === "left" ? -1 : 1);
    if (target !== lane) {
      fromLane = lane;
      lane = target;
      laneT = 0;
    }
  }

  // --- Vertical timers ----------------------------------------------------
  // Capture whether we are within a slide's coyote tail BEFORE advancing the
  // timer, so a late jump in the slide's final window is forgiven this frame.
  const inSlideCoyote = mode === "sliding" && SLIDE_SECONDS - vt <= COYOTE_SECONDS;
  if (mode === "jumping") {
    vt += dt;
    if (vt >= JUMP_SECONDS) {
      mode = "grounded";
      vt = 0;
    }
  } else if (mode === "sliding") {
    vt += dt;
    if (vt >= SLIDE_SECONDS) {
      mode = "grounded";
      vt = 0;
    }
  }

  // --- Buffer bookkeeping -------------------------------------------------
  if (buffered !== null) {
    bufferAge += dt;
    if (bufferAge > BUFFER_SECONDS) {
      buffered = null;
      bufferAge = 0;
    }
  }

  // Fold a jump/slide intent into the buffer slot; act on the freshest pending
  // action (the explicit intent this frame, else whatever is buffered).
  let action: Exclude<Intent, "left" | "right"> | null = null;
  if (intent === "jump" || intent === "slide") {
    action = intent;
  } else if (buffered !== null) {
    action = buffered;
  }

  if (action !== null) {
    const grounded = mode === "grounded";
    // Coyote: a jump in the final window of a slide cancels it and fires now.
    const coyoteJump = action === "jump" && mode === "sliding" && inSlideCoyote;
    if (grounded || coyoteJump) {
      mode = action === "jump" ? "jumping" : "sliding";
      vt = 0;
      buffered = null;
      bufferAge = 0;
    } else if (intent === "jump" || intent === "slide") {
      // Could not act now: buffer the freshly pressed intent for replay.
      buffered = intent;
      bufferAge = 0;
    }
  }

  return { lane, fromLane, laneT, mode, vt, buffered, bufferAge };
}

/** Smoothstep easing for the lateral tween (eases in and out). */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Project the player state to a render-facing pose. */
export function pose(state: PlayerState): PlayerPose {
  const from = LANE_X[state.fromLane];
  const to = LANE_X[state.lane];
  const x = from + (to - from) * smoothstep(state.laneT);

  let y = 0;
  let squash = 1;
  if (state.mode === "jumping") {
    // Parabolic arc: 0 at the ends, JUMP_HEIGHT at the midpoint.
    const u = state.vt / JUMP_SECONDS; // 0..1
    y = JUMP_HEIGHT * 4 * u * (1 - u);
  } else if (state.mode === "sliding") {
    squash = 0.5;
  }
  return { x, y, squash };
}
