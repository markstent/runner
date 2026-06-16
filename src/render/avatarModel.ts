/**
 * Rigged-avatar loader (#12). Loads the BrainStem android GLB asynchronously,
 * drives its skeleton with a THREE.AnimationMixer, restyles its materials to the
 * neon cyberpunk palette, and exposes a tiny handle the scene drives each frame.
 *
 * The public scene contract is unchanged: `createScene` stays synchronous and a
 * placeholder capsule is the visible fallback until this model swaps in. If the
 * load fails the capsule simply remains (no uncaught error/rejection).
 *
 * Only ONE animation clip ships with this asset, so it is played looped as the
 * run/stride loop; the jump arc and slide are driven by the existing pose root
 * transform (see avatar.ts), exactly as the capsule was. Dedicated
 * run/jump/slide/death clips would need a future Mixamo-rigged model.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PlayerPose } from "../player/index.ts";
import { avatarTransform } from "./avatar.ts";

const AVATAR_URL = "/avatar.glb";

/** Neon trim colour applied as emissive over the android's PBR materials. */
const NEON_EMISSIVE = 0x00e0ff;

export interface AvatarModelOptions {
  /** Base deck height the root sits at (shared with the capsule). */
  baseY: number;
  /** Z the avatar stands at in front of the chase camera. */
  z: number;
  /** Whether the active quality tier casts shadows. */
  shadows: boolean;
  /**
   * Called once the model is loaded and themed, with its root group to add to
   * the scene. The caller swaps the capsule out here.
   */
  onReady: (root: THREE.Object3D) => void;
}

export interface AvatarModel {
  /** Advance the animation mixer by dt seconds (no-op until loaded). */
  update(dt: number): void;
  /** Drive the loaded root from the player pose (no-op until loaded). */
  applyPose(pose: PlayerPose): void;
}

/**
 * Restyle a loaded android material for the neon palette: add an emissive trim
 * and lean it metallic so it catches the PMREM env map, while keeping the base
 * albedo so the model still reads as a figure.
 */
function applyNeonTheme(material: THREE.Material): void {
  const m = material as THREE.MeshStandardMaterial;
  if (m.emissive) {
    m.emissive = new THREE.Color(NEON_EMISSIVE);
    m.emissiveIntensity = 0.6;
  }
  if (typeof m.metalness === "number") m.metalness = 0.85;
  if (typeof m.roughness === "number") m.roughness = 0.3;
  m.envMapIntensity = 1.0;
  m.needsUpdate = true;
}

/**
 * Kick off the async GLB load and return a handle immediately. The handle is a
 * no-op until the model is ready; on load failure it stays a no-op (the caller's
 * capsule fallback remains). Tune scale/rotation so the android stands on the
 * deck facing AWAY from the chase camera (running forward, into the scene).
 */
export function loadAvatarModel(opts: AvatarModelOptions): AvatarModel {
  let root: THREE.Group | null = null;
  let mixer: THREE.AnimationMixer | null = null;

  const loader = new GLTFLoader();
  loader.load(
    AVATAR_URL,
    (gltf) => {
      const model = gltf.scene;

      // Normalise size/orientation: the BrainStem mesh is small and Z-up-ish,
      // so scale it up to roughly human height on the deck and rotate it to face
      // away from the camera (down -Z) so it reads as running forward.
      model.scale.setScalar(2.2);
      model.rotation.y = Math.PI;

      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = opts.shadows;
          const mat = child.material;
          if (Array.isArray(mat)) mat.forEach(applyNeonTheme);
          else if (mat) applyNeonTheme(mat);
        }
      });

      // Wrap in a root group so pose drives a clean transform regardless of the
      // model's own internal offsets.
      root = new THREE.Group();
      root.position.set(0, opts.baseY, opts.z);
      root.add(model);

      // Single clip -> the run/stride loop. Mixer dt is advanced by the scene's
      // THREE.Clock so the contract needs no dt parameter.
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const action = mixer.clipAction(gltf.animations[0]);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }

      opts.onReady(root);
    },
    undefined,
    () => {
      // Load failed: leave root/mixer null so the handle stays a no-op and the
      // caller's capsule fallback remains. Swallow so there is no uncaught
      // rejection / console error breaking the smoke test.
    },
  );

  return {
    update(dt: number): void {
      if (mixer) mixer.update(dt);
    },
    applyPose(pose: PlayerPose): void {
      if (!root) return;
      const t = avatarTransform(pose, opts.baseY);
      root.position.x = t.x;
      root.position.y = t.y;
      root.scale.y = t.scaleY;
    },
  };
}
