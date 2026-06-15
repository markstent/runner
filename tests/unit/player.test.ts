import { describe, it, expect } from "vitest";
import {
  createInitialPlayer,
  step,
  pose,
  LANE_TWEEN_SECONDS,
  JUMP_SECONDS,
  JUMP_HEIGHT,
  SLIDE_SECONDS,
  BUFFER_SECONDS,
  COYOTE_SECONDS,
  type Intent,
  type PlayerState,
} from "../../src/player/index.ts";

// Advance the player with `intent` on the first frame then `null` after, until
// `pred` holds or we exceed a frame budget. Returns the resulting state.
function run(
  state: PlayerState,
  intent: Intent | null,
  pred: (s: PlayerState) => boolean,
  dt = 1 / 60,
  maxFrames = 600,
): PlayerState {
  let s = step(state, intent, dt);
  for (let i = 0; i < maxFrames && !pred(s); i++) {
    s = step(s, null, dt);
  }
  return s;
}

describe("player lane transitions", () => {
  it("a move-right intent moves the player from center to the right lane", () => {
    const start = createInitialPlayer();
    expect(start.lane).toBe("center");

    const s = run(start, "right", (p) => p.lane === "right" && p.laneT >= 1);
    expect(s.lane).toBe("right");
    expect(pose(s).x).toBeCloseTo(4); // LANE_X.right
  });

  it("a move-left intent moves the player from center to the left lane", () => {
    const s = run(createInitialPlayer(), "left", (p) => p.lane === "left" && p.laneT >= 1);
    expect(s.lane).toBe("left");
    expect(pose(s).x).toBeCloseTo(-4); // LANE_X.left
  });

  it("cannot move past the right edge lane", () => {
    let s = run(createInitialPlayer(), "right", (p) => p.lane === "right" && p.laneT >= 1);
    s = run(s, "right", (p) => p.laneT >= 1); // second right press is a no-op
    expect(s.lane).toBe("right");
  });

  it("cannot move past the left edge lane", () => {
    let s = run(createInitialPlayer(), "left", (p) => p.lane === "left" && p.laneT >= 1);
    s = run(s, "left", (p) => p.laneT >= 1);
    expect(s.lane).toBe("left");
  });

  it("moves only one lane at a time: a move during a tween is ignored", () => {
    const start = createInitialPlayer();
    // Fire right, then immediately fire right again before the tween settles.
    let s = step(start, "right", 1 / 60);
    expect(s.lane).toBe("right");
    expect(s.laneT).toBeLessThan(1);
    const mid = step(s, "right", 1 / 60); // ignored: tween not finished
    expect(mid.lane).toBe("right");
    // After settling, a further right reaches center? No: from right, right clamps.
    const settled = run(mid, null, (p) => p.laneT >= 1);
    expect(settled.lane).toBe("right");
  });

  it("pose x lerps between lanes mid-tween (not snapped)", () => {
    // Frame 1 retargets to right (laneT=0). Frame 2 advances the tween halfway.
    let s = step(createInitialPlayer(), "right", LANE_TWEEN_SECONDS / 2);
    s = step(s, null, LANE_TWEEN_SECONDS / 2);
    const x = pose(s).x;
    expect(x).toBeGreaterThan(0); // moved off center
    expect(x).toBeLessThan(4); // not yet at right
  });
});

describe("player jump arc", () => {
  it("a jump intent leaves the grounded state on the same frame", () => {
    const s = step(createInitialPlayer(), "jump", 1 / 60);
    expect(s.mode).toBe("jumping");
    expect(pose(s).y).toBeGreaterThanOrEqual(0);
  });

  it("rises then falls, returning to grounded after JUMP_SECONDS", () => {
    let s = step(createInitialPlayer(), "jump", 1 / 60);
    let peak = 0;
    // Step through the whole arc, tracking peak height.
    for (let t = 0; t < JUMP_SECONDS + 0.1; t += 1 / 60) {
      peak = Math.max(peak, pose(s).y);
      s = step(s, null, 1 / 60);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(JUMP_HEIGHT + 1e-6); // height is bounded
    expect(s.mode).toBe("grounded");
    expect(pose(s).y).toBeCloseTo(0);
  });

  it("ignores a second jump while airborne (outside the coyote window)", () => {
    let s = step(createInitialPlayer(), "jump", 1 / 60);
    // Advance past the coyote window, still airborne.
    s = step(s, null, COYOTE_SECONDS + 1 / 60);
    const before = s.vt;
    s = step(s, "jump", 1 / 60); // should be buffered, not restart the arc
    expect(s.vt).toBeGreaterThan(before); // arc kept progressing, not reset to ~0
    expect(s.mode).toBe("jumping");
  });

  it("can switch lanes while jumping (vertical and lateral are independent)", () => {
    let s = step(createInitialPlayer(), "jump", 1 / 60);
    s = step(s, "right", 1 / 60);
    expect(s.mode).toBe("jumping");
    expect(s.lane).toBe("right");
  });
});

describe("player slide", () => {
  it("a slide intent enters the sliding state and squashes the pose", () => {
    const s = step(createInitialPlayer(), "slide", 1 / 60);
    expect(s.mode).toBe("sliding");
    expect(pose(s).squash).toBeLessThan(1);
  });

  it("auto-returns to grounded after SLIDE_SECONDS", () => {
    let s = step(createInitialPlayer(), "slide", 1 / 60);
    for (let t = 0; t < SLIDE_SECONDS + 0.1; t += 1 / 60) {
      s = step(s, null, 1 / 60);
    }
    expect(s.mode).toBe("grounded");
    expect(pose(s).squash).toBeCloseTo(1);
  });

  it("cannot jump while sliding; the jump is buffered, not applied immediately", () => {
    let s = step(createInitialPlayer(), "slide", 1 / 60);
    s = step(s, "jump", 1 / 60);
    expect(s.mode).toBe("sliding"); // still sliding this frame
    expect(s.buffered).toBe("jump"); // jump remembered for replay
  });
});

describe("player input buffering", () => {
  it("a jump pressed just before landing fires the moment the player is grounded", () => {
    // Jump, then near the end of the arc press jump again. It should replay as a
    // fresh jump once grounded, without a missed frame.
    let s = step(createInitialPlayer(), "jump", 1 / 60);
    // Advance to within BUFFER_SECONDS of the arc end.
    while (JUMP_SECONDS - s.vt > BUFFER_SECONDS / 2) s = step(s, null, 1 / 60);
    s = step(s, "jump", 1 / 60); // buffered: still airborne
    expect(s.buffered).toBe("jump");
    // Let the arc finish; the buffered jump should auto-fire a new jump.
    s = step(s, null, 1 / 60);
    // Within a couple frames we should be jumping again (buffer replayed).
    let firedAgain = false;
    for (let i = 0; i < 5; i++) {
      if (s.mode === "jumping") firedAgain = true;
      s = step(s, null, 1 / 60);
    }
    expect(firedAgain).toBe(true);
  });

  it("a buffered intent expires if it cannot act within BUFFER_SECONDS", () => {
    let s = step(createInitialPlayer(), "jump", 1 / 60);
    s = step(s, null, 1 / 60); // mid-arc, well outside any landing window
    s = step(s, "jump", 1 / 60); // buffered
    expect(s.buffered).toBe("jump");
    // Hold null past the buffer window while still airborne.
    s = step(s, null, BUFFER_SECONDS + 1 / 60);
    expect(s.buffered).toBeNull();
  });
});

describe("player coyote time", () => {
  it("a jump in the final coyote window of a slide cancels it and jumps now", () => {
    let s = step(createInitialPlayer(), "slide", 1 / 60);
    // Advance to inside the final COYOTE_SECONDS of the slide.
    while (SLIDE_SECONDS - s.vt > COYOTE_SECONDS / 2) s = step(s, null, 1 / 60);
    expect(s.mode).toBe("sliding");
    s = step(s, "jump", 1 / 60); // coyote: cancels slide, jumps immediately
    expect(s.mode).toBe("jumping");
  });

  it("a jump early in a slide is buffered, not coyote-fired", () => {
    let s = step(createInitialPlayer(), "slide", 1 / 60); // vt ~ 0, far from the end
    s = step(s, "jump", 1 / 60);
    expect(s.mode).toBe("sliding");
    expect(s.buffered).toBe("jump");
  });
});

describe("step purity", () => {
  it("does not mutate the input state", () => {
    const start = createInitialPlayer();
    const snapshot = JSON.stringify(start);
    step(start, "right", 1 / 60);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
