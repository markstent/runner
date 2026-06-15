import * as THREE from "three";
import { LANE_X, type Placement } from "../track/index.ts";

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
   */
  render(distance: number, placements?: readonly Placement[]): void;
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
 * Minimal cyberpunk rendering spine: a lit ground plane that scrolls toward a
 * fixed chase camera, plus a recycled pool of obstacle/coin meshes positioned
 * by the active track placements. No collision, scoring, or post-processing.
 */
export function createScene(canvas: HTMLCanvasElement): RenderScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(0x05010f);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05010f, 20, 120);

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
      metalness: 0.4,
      roughness: 0.6,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -PLANE_LENGTH / 2 + 10;
  scene.add(ground);

  const ambient = new THREE.AmbientLight(0x2030ff, 0.4);
  const key = new THREE.DirectionalLight(0xff40c0, 1.2);
  key.position.set(5, 20, 10);
  scene.add(ambient, key);

  // --- Placement mesh pool (obstacles + coins) ---------------------------
  // Shared geometries/materials keep draw cost low; meshes are recycled rather
  // than created/destroyed as the track scrolls past the camera.
  const themed = makeThemedMeshes();
  const pool: THREE.Mesh[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const m = new THREE.Mesh(themed.coin.geometry, themed.coin.material);
    m.visible = false;
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

  function render(distance: number, placements: readonly Placement[] = []): void {
    lastDistance = distance;
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

    renderer.render(scene, camera);
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { render, resize, domElement: canvas };
}
