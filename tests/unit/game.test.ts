import { describe, it, expect } from "vitest";
import { createInitialState, begin, crash, restart, tick } from "../../src/game/state.ts";

describe("game state machine", () => {
  it("begins in the start state", () => {
    expect(createInitialState().phase).toBe("start");
  });

  it("begin() transitions start -> playing", () => {
    const next = begin(createInitialState());
    expect(next.phase).toBe("playing");
  });

  it("crash() transitions playing -> gameOver", () => {
    const next = crash(begin(createInitialState()));
    expect(next.phase).toBe("gameOver");
  });

  it("restart() transitions gameOver -> playing for an immediate replay", () => {
    const over = crash(begin(createInitialState()));
    expect(restart(over).phase).toBe("playing");
  });

  it("tick(dt) advances world distance while playing", () => {
    const playing = begin(createInitialState());
    const after = tick(playing, 1);
    expect(after.distance).toBeGreaterThan(0);
  });

  it("tick(dt) does not advance distance in start or gameOver", () => {
    expect(tick(createInitialState(), 1).distance).toBe(0);
    const over = crash(begin(createInitialState()));
    expect(tick(over, 1).distance).toBe(over.distance);
  });

  it("tick(dt) is pure: distance is proportional to dt and the input is untouched", () => {
    const playing = begin(createInitialState());
    const a = tick(playing, 0.5);
    const b = tick(playing, 1);
    expect(b.distance).toBeCloseTo(a.distance * 2);
    expect(playing.distance).toBe(0);
  });

  it("restart() resets world distance to zero", () => {
    let s = begin(createInitialState());
    s = tick(s, 5);
    s = crash(s);
    expect(restart(s).distance).toBe(0);
  });
});
