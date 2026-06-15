import * as THREE from "three";

const PLANE_LENGTH = 200;
const PLANE_WIDTH = 12;
// Texture repeats per world unit; drives the scrolling stripe effect.
const SCROLL_TEXELS_PER_UNIT = 0.5;

export interface RenderScene {
  render(distance: number): void;
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

/**
 * Minimal cyberpunk rendering spine: a lit ground plane that scrolls toward a
 * fixed chase camera. No gameplay, obstacles, or post-processing.
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

  function render(distance: number): void {
    // Scroll the deck toward the camera by offsetting the texture; the plane
    // itself stays put so the camera remains a fixed chase rig.
    groundTexture.offset.y = -distance * SCROLL_TEXELS_PER_UNIT;
    renderer.render(scene, camera);
  }

  function resize(width: number, height: number): void {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { render, resize, domElement: canvas };
}
