import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/examples/jsm/postprocessing/AfterimagePass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LANE_X, type Placement } from "../track/index.ts";
import type { PlayerPose } from "../player/index.ts";
import { selectQualityTier, TIER_SETTINGS, type DeviceCaps } from "./quality.ts";
import { avatarTransform } from "./avatar.ts";
import { loadAvatarModel } from "./avatarModel.ts";

// Where the avatar stands in front of the fixed chase camera (small negative Z).
const AVATAR_Z = -2;
// Base height of the placeholder avatar capsule (sits on the deck at this y).
const AVATAR_BASE_Y = 1;

const PLANE_LENGTH = 200;
const PLANE_WIDTH = 12;
// Texture repeats per world unit; drives the scrolling stripe effect.
const SCROLL_TEXELS_PER_UNIT = 0.5;

// How far ahead (world units) a placement spawns, and how far behind the camera
// it lives before being recycled. The world scrolls toward the camera, so a
// placement's screen depth is (placement.z - distance).
const SPAWN_AHEAD = 140;
const DESPAWN_BEHIND = 15;
// Max number of placement meshes alive at once (object pool size). The visible
// window holds well under this many.
const POOL_SIZE = 48;

export interface RenderScene {
  /**
   * Render one frame. `distance` scrolls the deck; `placements` is the full
   * (or any superset of the active) track. Placements whose screen depth lands
   * in the visible window are drawn as themed meshes; others are recycled into
   * an object pool. Coins and obstacle types each get a distinct mesh.
   *
   * `pose` is the player's render pose from src/player (`pose(playerState)`):
   * its `x` drives the avatar's lane, `y` its jump height, and `squash` its
   * slide crouch. Optional and additive (mirrors how `placements` was added) so
   * existing callers keep working; when omitted the avatar stays at rest. The
   * rigged-model swap (#12) reuses this same pose contract.
   */
  render(distance: number, placements?: readonly Placement[], pose?: PlayerPose): void;
  resize(width: number, height: number): void;
  readonly domElement: HTMLCanvasElement;
}

function makeGridTexture(): THREE.Texture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const onLine = x % 16 === 0 || y % 16 === 0;
      data[i] = onLine ? 255 : 10; // neon magenta lines on dark deck
      data[i + 1] = onLine ? 40 : 6;
      data[i + 2] = onLine ? 200 : 24;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(PLANE_WIDTH * SCROLL_TEXELS_PER_UNIT, PLANE_LENGTH * SCROLL_TEXELS_PER_UNIT);
  tex.needsUpdate = true;
  return tex;
}

interface ThemedMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  y: number;
  rotation: THREE.Euler;
}

/**
 * Build one themed prototype (geometry + material + transform) per placement
 * type. Cyberpunk palette: cyan low hurdles, magenta high bars, red full
 * blocks, gold spinning coins.
 */
function makeThemedMeshes(): Record<Placement["type"], ThemedMesh> {
  const noRot = new THREE.Euler();
  const coinGeo = new THREE.TorusGeometry(0.6, 0.18, 8, 16);
  return {
    "obstacle-low": {
      // Low hurdle: short, sits on the deck; cleared by jumping.
      geometry: new THREE.BoxGeometry(2.4, 1, 1),
      material: new THREE.MeshStandardMaterial({
        color: 0x00e0ff,
        emissive: 0x004055,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.4,
      }),
      y: 0.5,
      rotation: noRot,
    },
    "obstacle-high": {
      // High bar: floats above the deck; cleared by sliding under.
      geometry: new THREE.BoxGeometry(2.4, 1, 1),
      material: new THREE.MeshStandardMaterial({
        color: 0xff40c0,
        emissive: 0x551036,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.4,
      }),
      y: 2.6,
      rotation: noRot,
    },
    "full-block": {
      // Full block: floor to head height; impassable.
      geometry: new THREE.BoxGeometry(2.6, 3.2, 1),
      material: new THREE.MeshStandardMaterial({
        color: 0xff2040,
        emissive: 0x550010,
        emissiveIntensity: 0.9,
        metalness: 0.3,
        roughness: 0.5,
      }),
      y: 1.6,
      rotation: noRot,
    },
    coin: {
      geometry: coinGeo,
      material: new THREE.MeshStandardMaterial({
        color: 0xffd040,
        emissive: 0x553600,
        emissiveIntensity: 1.0,
        metalness: 0.8,
        roughness: 0.2,
      }),
      y: 1.2,
      rotation: new THREE.Euler(0, Math.PI / 2, 0),
    },
  };
}

/**
 * Probe coarse device capabilities from the live renderer + browser so the
 * quality tier can be chosen without hard-coding. Falls back to safe values
 * when something is unavailable (which steers the tier toward "low").
 */
function probeCaps(renderer: THREE.WebGLRenderer): DeviceCaps {
  const gl = renderer.getContext();
  let maxTextureSize = 0;
  try {
    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  } catch {
    maxTextureSize = 0;
  }
  const devicePixelRatio =
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // Low-power hint: a coarse pointer with no hover is a strong mobile signal.
  let lowPower = false;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    lowPower =
      window.matchMedia("(pointer: coarse)").matches &&
      !window.matchMedia("(hover: hover)").matches;
  }
  return { devicePixelRatio, maxTextureSize, lowPower };
}

/**
 * Build a small procedural neon cube environment map used both as the scene
 * environment (subtle IBL on the PBR materials) and as the source of the
 * floor's reflections. This is the pragmatic "reflections" approximation: a
 * reflective metallic floor sampling an env map rather than a true real-time
 * reflection pass, which keeps the frame budget intact.
 */
function makeNeonEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x05010f);
  // A few large emissive panels give the floor coloured neon highlights.
  const panels: Array<[number, number, number, number]> = [
    [0xff20a0, -8, 6, 0],
    [0x20e0ff, 8, 6, 0],
    [0x9020ff, 0, 10, -8],
  ];
  for (const [color, x, y, z] of panels) {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ color }),
    );
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene).texture;
  pmrem.dispose();
  return env;
}

/**
 * Cyberpunk rendering spine: a lit ground plane that scrolls toward a fixed
 * chase camera, a recycled pool of obstacle/coin meshes, and a placeholder
 * avatar driven by the player pose. Rendering is wrapped in an EffectComposer
 * (bloom, motion blur, depth of field) whose passes and internal resolution are
 * selected by a quality tier derived from device capabilities; weaker/mobile
 * GPUs downgrade gracefully. Reflections are an env-map approximation on the
 * metallic floor. No collision, scoring, or game logic here.
 */
export function createScene(canvas: HTMLCanvasElement): RenderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x05010f);

  const tier = selectQualityTier(probeCaps(renderer));
  const settings = TIER_SETTINGS[tier];
  if (settings.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05010f, 20, 120);

  // Env map drives both subtle PBR image-based lighting and the floor's neon
  // reflections (see makeNeonEnvMap). Skipped on the low tier to save cost.
  const envMap = settings.reflections ? makeNeonEnvMap(renderer) : null;
  if (envMap) scene.environment = envMap;

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, -30);

  const groundTexture = makeGridTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_LENGTH),
    new THREE.MeshStandardMaterial({
      map: groundTexture,
      emissive: 0x110022,
      emissiveIntensity: 0.6,
      // When reflections are on, a smoother, more metallic floor catches the
      // neon env map; otherwise keep the plain matte deck.
      metalness: settings.reflections ? 0.9 : 0.4,
      roughness: settings.reflections ? 0.25 : 0.6,
      envMapIntensity: settings.reflections ? 1.0 : 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -PLANE_LENGTH / 2 + 10;
  ground.receiveShadow = settings.shadows;
  scene.add(ground);

  const ambient = new THREE.AmbientLight(0x2030ff, 0.4);
  const key = new THREE.DirectionalLight(0xff40c0, 1.2);
  key.position.set(5, 20, 10);
  if (settings.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 80;
    const d = 20;
    key.shadow.camera.left = -d;
    key.shadow.camera.right = d;
    key.shadow.camera.top = d;
    key.shadow.camera.bottom = -d;
  }
  scene.add(ambient, key);

  // --- Avatar (rigged GLB with capsule fallback) --------------------------
  // The placeholder capsule is the VISIBLE FALLBACK: it is shown immediately
  // (createScene is synchronous) and stays until the rigged BrainStem GLB
  // (#12) finishes loading, at which point the model is swapped in and the
  // capsule hidden. If the GLB load fails the capsule simply remains and the
  // game keeps working. Both are driven from the player pose via the same pure
  // helper (avatar.ts): x = lane, y += jump height, vertical squash for slide.
  const avatar = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1, 6, 12),
    new THREE.MeshStandardMaterial({
      color: 0x60ffe0,
      emissive: 0x008866,
      emissiveIntensity: 0.9,
      metalness: 0.4,
      roughness: 0.3,
    }),
  );
  avatar.position.set(0, AVATAR_BASE_Y, AVATAR_Z);
  avatar.castShadow = settings.shadows;
  scene.add(avatar);

  // Async-load the rigged model; swap it in over the capsule once ready. The
  // mixer is advanced by `clock` each frame (the render() contract has no dt).
  const clock = new THREE.Clock();
  const avatarModel = loadAvatarModel({
    baseY: AVATAR_BASE_Y,
    z: AVATAR_Z,
    shadows: settings.shadows,
    onReady: (root) => {
      scene.add(root);
      avatar.visible = false;
    },
  });

  // --- Placement mesh pool (obstacles + coins) ---------------------------
  // Shared geometries/materials keep draw cost low; meshes are recycled rather
  // than created/destroyed as the track scrolls past the camera.
  const themed = makeThemedMeshes();
  const pool: THREE.Mesh[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const m = new THREE.Mesh(themed.coin.geometry, themed.coin.material);
    m.visible = false;
    m.castShadow = settings.shadows;
    scene.add(m);
    pool.push(m);
  }

  function applyTheme(mesh: THREE.Mesh, p: Placement): void {
    const t = themed[p.type];
    mesh.geometry = t.geometry;
    mesh.material = t.material;
    mesh.position.x = LANE_X[p.lane];
    mesh.position.y = t.y;
    mesh.position.z = -(p.z - lastDistance); // toward camera as distance grows
    mesh.rotation.copy(t.rotation);
    mesh.visible = true;
  }

  let lastDistance = 0;

  // --- Post-processing composer ------------------------------------------
  // Wrapped internally so the createScene contract is unchanged: render()/resize()
  // drive the composer instead of the raw renderer. Passes are gated by tier.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass: UnrealBloomPass | null = null;
  if (settings.bloom) {
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1), // sized in resize()
      0.9, // strength
      0.6, // radius
      0.85, // threshold: only bright neon blooms
    );
    composer.addPass(bloomPass);
  }

  if (settings.depthOfField) {
    const bokeh = new BokehPass(scene, camera, {
      focus: 14, // ~where obstacles read sharp ahead of the avatar
      aperture: 0.0006,
      maxblur: 0.01,
    });
    composer.addPass(bokeh);
  }

  if (settings.motionBlur) {
    const afterimage = new AfterimagePass(0.82); // subtle speed trails
    composer.addPass(afterimage);
  }

  // OutputPass handles tone mapping + color space at the end of the chain.
  composer.addPass(new OutputPass());

  function render(
    distance: number,
    placements: readonly Placement[] = [],
    pose?: PlayerPose,
  ): void {
    lastDistance = distance;

    // Advance the rigged model's animation mixer by real elapsed time (the
    // render() contract carries no dt, so the scene owns a THREE.Clock).
    avatarModel.update(clock.getDelta());

    // Drive the avatar from the player pose (lane x, jump y, slide squash) via
    // the shared pure helper. Squashing scales y and keeps the base on the deck
    // by lowering the centre accordingly. The capsule fallback and the rigged
    // model use the same mapping, so the swap is visually equivalent. Omitting
    // `pose` leaves the avatar at rest.
    if (pose) {
      const t = avatarTransform(pose, AVATAR_BASE_Y);
      avatar.position.x = t.x;
      avatar.scale.y = t.scaleY;
      avatar.position.y = t.y;
      avatarModel.applyPose(pose);
    }
    // Scroll the deck toward the camera by offsetting the texture; the plane
    // itself stays put so the camera remains a fixed chase rig.
    groundTexture.offset.y = -distance * SCROLL_TEXELS_PER_UNIT;

    // Recycle: assign the active (visible-window) placements to pool meshes.
    let slot = 0;
    for (const p of placements) {
      const depth = p.z - distance; // ahead is positive
      if (depth > SPAWN_AHEAD || depth < -DESPAWN_BEHIND) continue; // out of window
      if (slot >= pool.length) break; // pool exhausted (should not happen)
      applyTheme(pool[slot], p);
      slot++;
    }
    for (let i = slot; i < pool.length; i++) pool[i].visible = false;

    composer.render();
  }

  function resize(width: number, height: number): void {
    // renderScale shrinks the internal render target on weaker tiers while the
    // canvas keeps its CSS size, trading sharpness for frame budget.
    const scale = settings.renderScale;
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(scale);
    composer.setSize(width, height);
    composer.setPixelRatio(scale);
    if (bloomPass) bloomPass.setSize(width * scale, height * scale);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { render, resize, domElement: canvas };
}
