import { describe, it, expect } from "vitest";
import { avatarTransform } from "../../src/render/avatar.ts";
import type { PlayerPose } from "../../src/player/index.ts";

const BASE_Y = 1;

describe("avatarTransform", () => {
  it("places the avatar at rest in the centre on its base height", () => {
    const pose: PlayerPose = { x: 0, y: 0, squash: 1 };
    expect(avatarTransform(pose, BASE_Y)).toEqual({ x: 0, y: BASE_Y, scaleY: 1 });
  });

  it("drives the lane from pose.x", () => {
    const pose: PlayerPose = { x: -3, y: 0, squash: 1 };
    expect(avatarTransform(pose, BASE_Y).x).toBe(-3);
  });

  it("raises the avatar by the jump height", () => {
    const pose: PlayerPose = { x: 0, y: 2.4, squash: 1 };
    expect(avatarTransform(pose, BASE_Y).y).toBe(BASE_Y + 2.4);
  });

  it("squashes vertical scale and keeps the base on the deck while sliding", () => {
    const pose: PlayerPose = { x: 0, y: 0, squash: 0.5 };
    const t = avatarTransform(pose, BASE_Y);
    expect(t.scaleY).toBe(0.5);
    // Centre drops so the squashed avatar still sits on the deck (matches capsule).
    expect(t.y).toBe(BASE_Y * 0.5);
  });
});
