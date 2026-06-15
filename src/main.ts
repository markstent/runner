import { createScene } from "./render/scene.ts";
import {
  createInitialState,
  begin,
  crash,
  restart,
  tick,
  type GameState,
} from "./game/state.ts";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const coinsEl = document.getElementById("coins") as HTMLElement;
const finalScoreEl = document.getElementById("final-score") as HTMLElement;
const startOverlay = document.getElementById("start-overlay") as HTMLElement;
const gameOverOverlay = document.getElementById("gameover-overlay") as HTMLElement;
const startButton = document.getElementById("start-button") as HTMLButtonElement;
const restartButton = document.getElementById("restart-button") as HTMLButtonElement;

const scene = createScene(canvas);

let state: GameState = createInitialState();

function score(s: GameState): number {
  return Math.floor(s.distance);
}

function syncOverlays(): void {
  startOverlay.hidden = state.phase !== "start";
  gameOverOverlay.hidden = state.phase !== "gameOver";
  hud.hidden = state.phase === "start";
  if (state.phase === "gameOver") finalScoreEl.textContent = String(score(state));
}

function syncHud(): void {
  scoreEl.textContent = String(score(state));
  coinsEl.textContent = "0"; // coins arrive in a later task
}

function resize(): void {
  scene.resize(window.innerWidth, window.innerHeight);
}

startButton.addEventListener("click", () => {
  state = begin(state);
  syncOverlays();
});

restartButton.addEventListener("click", () => {
  state = restart(state);
  syncOverlays();
});

// Expose minimal crash hook for the smoke test / future gameplay wiring.
(window as unknown as { __crash?: () => void }).__crash = () => {
  state = crash(state);
  syncOverlays();
};

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  state = tick(state, dt);
  syncHud();
  scene.render(state.distance);
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
syncOverlays();
syncHud();
requestAnimationFrame(frame);
