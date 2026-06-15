import { describe, it, expect } from "vitest";
import { createInitialPlayer, type PlayerState } from "../../src/player/index.ts";
import type { Placement } from "../../src/track/index.ts";
import { resolve, HALF_DEPTH, playerZ } from "../../src/collision/index.ts";

// The distance at which a placement sitting at z is level with the avatar:
// playerZ(distance) === distance + PLAYER_Z_OFFSET. We place obstacles exactly
// at the player's band by choosing z = playerZ(distance).
const DISTANCE = 100;
const AT = playerZ(DISTANCE); // a z value squarely inside the player's band

function grounded(lane: PlayerState["lane"]): PlayerState {
  return { ...createInitialPlayer(), lane, fromLane: lane, laneT: 1 };
}

describe("collision resolver: hits", () => {
  it("a full-block in the player's settled lane within the z-band is a hit", () => {
    const player = grounded("center");
    const entities: Placement[] = [{ lane: "center", z: AT, type: "full-block" }];
    const r = resolve(player, entities, DISTANCE);
    expect(r.hit).toBe(true);
    expect(r.coinsCollected).toBe(0);
  });

  it("a low obstacle is a hit while grounded but cleared while jumping", () => {
    const entities: Placement[] = [{ lane: "center", z: AT, type: "obstacle-low" }];
    expect(resolve(grounded("center"), entities, DISTANCE).hit).toBe(true);

    const jumping: PlayerState = { ...grounded("center"), mode: "jumping" };
    expect(resolve(jumping, entities, DISTANCE).hit).toBe(false);
  });

  it("a high obstacle is a hit while grounded but cleared while sliding", () => {
    const entities: Placement[] = [{ lane: "center", z: AT, type: "obstacle-high" }];
    expect(resolve(grounded("center"), entities, DISTANCE).hit).toBe(true);

    const sliding: PlayerState = { ...grounded("center"), mode: "sliding" };
    expect(resolve(sliding, entities, DISTANCE).hit).toBe(false);
  });

  it("a low obstacle is NOT cleared by sliding (wrong vertical action)", () => {
    const entities: Placement[] = [{ lane: "center", z: AT, type: "obstacle-low" }];
    const sliding: PlayerState = { ...grounded("center"), mode: "sliding" };
    expect(resolve(sliding, entities, DISTANCE).hit).toBe(true);
  });

  it("a full-block is never cleared by jumping or sliding", () => {
    const entities: Placement[] = [{ lane: "center", z: AT, type: "full-block" }];
    const jumping: PlayerState = { ...grounded("center"), mode: "jumping" };
    const sliding: PlayerState = { ...grounded("center"), mode: "sliding" };
    expect(resolve(jumping, entities, DISTANCE).hit).toBe(true);
    expect(resolve(sliding, entities, DISTANCE).hit).toBe(true);
  });

  it("an obstacle in a different lane is not a hit", () => {
    const entities: Placement[] = [{ lane: "left", z: AT, type: "full-block" }];
    expect(resolve(grounded("center"), entities, DISTANCE).hit).toBe(false);
  });

  it("an obstacle outside the z-band is ignored", () => {
    const entities: Placement[] = [
      { lane: "center", z: AT + HALF_DEPTH + 0.01, type: "full-block" },
    ];
    expect(resolve(grounded("center"), entities, DISTANCE).hit).toBe(false);
  });

  it("mid-tween the player occupies BOTH lanes: a hit registers on either", () => {
    // Tweening from left toward center (laneT < 1): both lanes occupied.
    const tween: PlayerState = {
      ...createInitialPlayer(),
      fromLane: "left",
      lane: "center",
      laneT: 0.5,
    };
    const onFrom: Placement[] = [{ lane: "left", z: AT, type: "full-block" }];
    const onTo: Placement[] = [{ lane: "center", z: AT, type: "full-block" }];
    expect(resolve(tween, onFrom, DISTANCE).hit).toBe(true);
    expect(resolve(tween, onTo, DISTANCE).hit).toBe(true);
  });
});

describe("collision resolver: coins", () => {
  it("a coin in an occupied lane within the z-band is collected, never a hit", () => {
    const coin: Placement = { lane: "center", z: AT, type: "coin" };
    const r = resolve(grounded("center"), [coin], DISTANCE);
    expect(r.hit).toBe(false);
    expect(r.coinsCollected).toBe(1);
    expect(r.collected).toEqual([coin]);
  });

  it("a coin in a different lane is not collected", () => {
    const coin: Placement = { lane: "left", z: AT, type: "coin" };
    const r = resolve(grounded("center"), [coin], DISTANCE);
    expect(r.coinsCollected).toBe(0);
    expect(r.collected).toEqual([]);
  });

  it("a coin outside the z-band is not collected", () => {
    const coin: Placement = { lane: "center", z: AT + HALF_DEPTH + 0.01, type: "coin" };
    expect(resolve(grounded("center"), [coin], DISTANCE).coinsCollected).toBe(0);
  });

  it("a coin is still collected while a hit also occurs in the same band", () => {
    const entities: Placement[] = [
      { lane: "center", z: AT, type: "coin" },
      { lane: "center", z: AT, type: "full-block" },
    ];
    const r = resolve(grounded("center"), entities, DISTANCE);
    expect(r.hit).toBe(true);
    expect(r.coinsCollected).toBe(1);
  });

  it("collects coins across both lanes while mid-tween", () => {
    const tween: PlayerState = {
      ...createInitialPlayer(),
      fromLane: "left",
      lane: "center",
      laneT: 0.5,
    };
    const entities: Placement[] = [
      { lane: "left", z: AT, type: "coin" },
      { lane: "center", z: AT, type: "coin" },
    ];
    expect(resolve(tween, entities, DISTANCE).coinsCollected).toBe(2);
  });
});
