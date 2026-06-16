/**
 * Pure, Three-free avatar helpers — the unit-testable seam for the rigged-model
 * swap (#12). The actual GLTF load + AnimationMixer live in `avatarModel.ts`
 * (which imports Three and is exercised by the Playwright smoke + manual run);
 * everything here is plain arithmetic so it can be tested without WebGL.
 */
import type { PlayerPose } from "../player/index.ts";

/** Root-transform values derived from a player pose. */
export interface AvatarTransform {
  /** World X (lane), straight from the pose. */
  x: number;
  /** World Y of the root: base height scaled by the slide squash, plus jump. */
  y: number;
  /** Vertical scale (the slide squash). */
  scaleY: number;
}

/**
 * Map a player pose to the avatar root transform. Identical behaviour for the
 * placeholder capsule and the rigged model so the swap is visually equivalent:
 * x = lane, vertical scale = squash, and the centre drops with the squash so the
 * base stays on the deck, with the jump height added on top.
 */
export function avatarTransform(pose: PlayerPose, baseY: number): AvatarTransform {
  return {
    x: pose.x,
    y: baseY * pose.squash + pose.y,
    scaleY: pose.squash,
  };
}
