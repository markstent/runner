/**
 * Pure collision resolution for the runner.
 *
 * This module has NO Three.js dependency. It is the seam between the player
 * state machine (src/player) + the world track (src/track) and the game's
 * crash / coin-tally glue (src/main.ts). Given the player STATE (lane occupancy
 * + vertical mode) and the active placements, it returns whether the player is
 * hit this frame and which coins were collected, as a pure value.
 *
 * Collision model (decisions documented here, per the issue brief)
 * ---------------------------------------------------------------
 * Player z-band. The avatar sits at a FIXED world Z near the front of the deck
 * (render/scene.ts: AVATAR_Z = -2). The world scrolls toward the camera, so a
 * placement at track distance `p.z` is drawn at world Z `-(p.z - distance)`
 * (render/scene.ts). A placement is level with the avatar when that world Z
 * equals AVATAR_Z, i.e. -(p.z - distance) = -2  =>  p.z = distance + 2. We call
 * `distance + PLAYER_Z_OFFSET` the player's effective world z (`playerZ`), and a
 * placement counts as "at" the player when abs(p.z - playerZ) <= HALF_DEPTH.
 * HALF_DEPTH is half a row of tolerance so a placement registers across the few
 * frames it straddles the avatar at the world scroll speed.
 *
 * Lane occupancy during a lateral tween. While the player is mid-switch
 * (laneT < 1) we treat them as occupying BOTH `fromLane` and `lane`. This is the
 * CONSERVATIVE choice: you cannot phase through a side obstacle by being caught
 * mid-tween. Once the tween settles (laneT >= 1) only `lane` is occupied
 * (fromLane equals lane by then anyway).
 *
 * Clearing rules (PlacementType from src/track):
 *  - mode === "jumping"  clears `obstacle-low`  (you jump over it).
 *  - mode === "sliding"  clears `obstacle-high` (you slide under it).
 *  - `full-block` is NEVER cleared by jump/slide; it is only avoided by being in
 *    a different lane.
 *  - a `coin` in an occupied lane within the z-band is COLLECTED and never a hit.
 *
 * A hit = an uncleared obstacle or full-block in an occupied lane within the
 * z-band.
 */
import type { PlayerState } from "../player/index.ts";
import type { Lane, Placement } from "../track/index.ts";

/**
 * Distance the player's collision band sits ahead of the current `distance`.
 * Derived from render/scene.ts: AVATAR_Z = -2 and world Z = -(z - distance),
 * so a placement is level with the avatar at z = distance + 2.
 */
export const PLAYER_Z_OFFSET = 2;

/**
 * Half-thickness of the player's z-band. A placement is "at" the player when it
 * is within HALF_DEPTH of `playerZ`. Half a row's worth of tolerance keeps the
 * check robust across the frames a placement spends crossing the avatar.
 */
export const HALF_DEPTH = 1.5;

/** The effective world z of the player for a given travelled distance. */
export function playerZ(distance: number): number {
  return distance + PLAYER_Z_OFFSET;
}

/** Result of resolving one frame of collisions. */
export interface CollisionResult {
  /** True if the player struck an uncleared obstacle or full-block this frame. */
  hit: boolean;
  /** Number of coins collected this frame. */
  coinsCollected: number;
  /**
   * The exact coin placements consumed this frame, so the caller can remove
   * them from the active world. References into the input array.
   */
  collected: Placement[];
}

/** The lanes the player occupies this frame (both during a tween). */
function occupiedLanes(player: PlayerState): Set<Lane> {
  const lanes = new Set<Lane>([player.lane]);
  if (player.laneT < 1) lanes.add(player.fromLane); // conservative: straddle both
  return lanes;
}

/** Whether the player's current vertical mode clears the given obstacle type. */
function clears(player: PlayerState, type: Placement["type"]): boolean {
  if (type === "obstacle-low") return player.mode === "jumping";
  if (type === "obstacle-high") return player.mode === "sliding";
  return false; // full-block is never cleared by jump/slide
}

/**
 * Resolve collisions for one frame. Pure: reads inputs, returns a value, never
 * mutates. `entities` may be the full track; only placements within the z-band
 * and an occupied lane are considered.
 */
export function resolve(
  player: PlayerState,
  entities: readonly Placement[],
  distance: number,
): CollisionResult {
  const pz = playerZ(distance);
  const lanes = occupiedLanes(player);

  let hit = false;
  const collected: Placement[] = [];

  for (const p of entities) {
    if (Math.abs(p.z - pz) > HALF_DEPTH) continue; // outside the z-band
    if (!lanes.has(p.lane)) continue; // not in an occupied lane

    if (p.type === "coin") {
      collected.push(p);
    } else if (!clears(player, p.type)) {
      hit = true;
    }
  }

  return { hit, coinsCollected: collected.length, collected };
}
