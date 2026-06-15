import { createScene } from "./render/scene.ts";
import { nextBatch, ROW_SPACING, type Placement } from "./track/index.ts";
import {
  createInitialState,
  begin,
  crash,
  restart,
  tick,
  type GameState,
} from "./game/state.ts";
import { createInitialPlayer, step, pose, type Intent } from "./player/index.ts";
import { resolve } from "./collision/index.ts";
import { attachInput } from "./input/index.ts";
import { scoreFor, createHighScore } from "./scoring/index.ts";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const coinsEl = document.getElementById("coins") as HTMLElement;
const finalScoreEl = document.getElementById("final-score") as HTMLElement;
const highScoreEl = document.getElementById("high-score") as HTMLElement;
const startOverlay = document.getElementById("start-overlay") as HTMLElement;
const gameOverOverlay = document.getElementById("gameover-overlay") as HTMLElement;
const startButton = document.getElementById("start-button") as HTMLButtonElement;
const restartButton = document.getElementById("restart-button") as HTMLButtonElement;

const scene = createScene(canvas);

let state: GameState = createInitialState();

// --- Endless track plumbing --------------------------------------------
// Generation math lives in the tested track module (`nextBatch`). main.ts holds
// only the imperative glue: the active track array, the grow-ahead trigger, the
// prune-behind, and feeding the active track to the renderer.
//
// Difficulty is a fixed input for now (#7 makes it dynamic). Each batch is a
// fair, deterministic placement sequence; we append the next batch (z-offset)
// before the player reaches the end, giving an endless clearable track.
const TRACK_DIFFICULTY = 0.5;
const RUN_SEED = 1337;

/** World-unit lookahead: keep generated track at least this far ahead of the player. */
const GROW_AHEAD_BUFFER = 200;
/** World-unit margin kept behind the camera before pruning passed placements. */
const KEEP_BEHIND_MARGIN = 60;
/** Only prune once the active window exceeds this many placements (cheap-window guard). */
const MAX_TRACKED_PLACEMENTS = 256;

let track: Placement[] = [];
let batchIndex = 0;
let batchEndZ = 0;

function appendBatch(): void {
  const batch = nextBatch(RUN_SEED, batchIndex, TRACK_DIFFICULTY, batchEndZ);
  track.push(...batch);
  batchEndZ = batch[batch.length - 1].z + ROW_SPACING;
  batchIndex++;
}

function resetTrack(): void {
  track = [];
  batchIndex = 0;
  batchEndZ = 0;
  appendBatch();
}

resetTrack();

// --- Player movement glue ----------------------------------------------
// Player state lives here (separate from GameState by design). Keydown intents
// are queued and drained one-per-frame into the pure `step`, so input reacts on
// the same frame it arrives. The resulting pose drives the placeholder avatar.
let player = createInitialPlayer();
const intentQueue: Intent[] = [];

// Coin tally lives here as composition-root glue (not in GameState), matching
// how player/track state is held in main.ts. Incremented by collision results.
let coins = 0;

attachInput(window, (intent) => {
  if (state.phase === "playing") intentQueue.push(intent);
});

// High-score store, persisted via real localStorage. Pure scoring + the storage
// seam live in src/scoring; main.ts only supplies the live distance + coin tally
// and the real storage backend. Construction is graceful if storage is absent.
const highScore = createHighScore(window.localStorage);

function score(s: GameState): number {
  return scoreFor(s.distance, coins);
}

function syncOverlays(): void {
  startOverlay.hidden = state.phase !== "start";
  gameOverOverlay.hidden = state.phase !== "gameOver";
  hud.hidden = state.phase === "start";
  if (state.phase === "gameOver") {
    const final = score(state);
    finalScoreEl.textContent = String(final);
    // Submit the final score; the returned best is what we display (covers the
    // new-best case and the keep-previous case alike).
    highScoreEl.textContent = String(highScore.submit(final));
  }
}

function syncHud(): void {
  scoreEl.textContent = String(score(state));
  coinsEl.textContent = String(coins);
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
  resetTrack();
  player = createInitialPlayer();
  intentQueue.length = 0;
  coins = 0;
  syncOverlays();
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  state = tick(state, dt);
  // Advance the player only while playing; drain one queued intent per frame so
  // movement reacts on the same frame as the keypress.
  if (state.phase === "playing") {
    const intent = intentQueue.shift() ?? null;
    player = step(player, intent, dt);

    // Resolve collisions against the active track at the player's z-band. A hit
    // ends the run; collected coins are removed from the world and tallied.
    const result = resolve(player, track, state.distance);
    if (result.collected.length > 0) {
      coins += result.coinsCollected;
      const consumed = new Set(result.collected);
      track = track.filter((p) => !consumed.has(p));
    }
    if (result.hit) {
      state = crash(state);
      syncOverlays();
    }
  }
  // Keep the track ahead of the player so it never runs out (endless).
  while (batchEndZ - state.distance < GROW_AHEAD_BUFFER) appendBatch();
  // Drop placements well behind the camera so the active window stays small.
  if (track.length > MAX_TRACKED_PLACEMENTS && track[0].z < state.distance - KEEP_BEHIND_MARGIN) {
    track = track.filter((p) => p.z >= state.distance - KEEP_BEHIND_MARGIN);
  }
  syncHud();
  scene.render(state.distance, track, pose(player));
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resize();
syncOverlays();
syncHud();
requestAnimationFrame(frame);
