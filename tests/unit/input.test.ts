import { describe, it, expect } from "vitest";
import { keyToIntent } from "../../src/input/index.ts";

describe("keyboard key -> intent mapping", () => {
  it("maps left controls to a left intent", () => {
    expect(keyToIntent("ArrowLeft")).toBe("left");
    expect(keyToIntent("KeyA")).toBe("left");
  });

  it("maps right controls to a right intent", () => {
    expect(keyToIntent("ArrowRight")).toBe("right");
    expect(keyToIntent("KeyD")).toBe("right");
  });

  it("maps up/space/W to a jump intent", () => {
    expect(keyToIntent("ArrowUp")).toBe("jump");
    expect(keyToIntent("KeyW")).toBe("jump");
    expect(keyToIntent("Space")).toBe("jump");
  });

  it("maps down/S to a slide intent", () => {
    expect(keyToIntent("ArrowDown")).toBe("slide");
    expect(keyToIntent("KeyS")).toBe("slide");
  });

  it("returns null for unmapped keys", () => {
    expect(keyToIntent("KeyZ")).toBeNull();
    expect(keyToIntent("Enter")).toBeNull();
    expect(keyToIntent("")).toBeNull();
  });
});
