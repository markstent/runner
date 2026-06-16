import { describe, it, expect } from "vitest";
import { swipeToIntent } from "../../src/input/index.ts";

const THRESHOLD = 30;

describe("swipe gesture -> intent mapping", () => {
  it("maps a rightward swipe to a right intent", () => {
    expect(swipeToIntent(60, 0, THRESHOLD)).toBe("right");
  });

  it("maps a leftward swipe to a left intent", () => {
    expect(swipeToIntent(-60, 0, THRESHOLD)).toBe("left");
  });

  it("maps an upward swipe to a jump intent", () => {
    // Screen Y grows downward, so an upward swipe has a negative dy.
    expect(swipeToIntent(0, -60, THRESHOLD)).toBe("jump");
  });

  it("maps a downward swipe to a slide intent", () => {
    expect(swipeToIntent(0, 60, THRESHOLD)).toBe("slide");
  });

  it("returns null when the gesture is below the threshold (a tap)", () => {
    expect(swipeToIntent(10, 5, THRESHOLD)).toBeNull();
    expect(swipeToIntent(0, 0, THRESHOLD)).toBeNull();
  });

  it("picks the dominant axis when horizontal travel exceeds vertical", () => {
    expect(swipeToIntent(80, 40, THRESHOLD)).toBe("right");
    expect(swipeToIntent(-80, 40, THRESHOLD)).toBe("left");
  });

  it("picks the dominant axis when vertical travel exceeds horizontal", () => {
    expect(swipeToIntent(40, 80, THRESHOLD)).toBe("slide");
    expect(swipeToIntent(40, -80, THRESHOLD)).toBe("jump");
  });

  it("breaks an exact axis tie in favour of the horizontal axis", () => {
    // |dx| === |dy|: prefer the lateral move (lane switches feel more frequent).
    expect(swipeToIntent(50, 50, THRESHOLD)).toBe("right");
    expect(swipeToIntent(-50, -50, THRESHOLD)).toBe("left");
  });

  it("requires the dominant axis to clear the threshold on its own", () => {
    // Horizontal dominates but is itself below threshold -> not a swipe.
    expect(swipeToIntent(20, 10, THRESHOLD)).toBeNull();
  });
});
