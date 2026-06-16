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
import { resolve, playerZ, HALF_DEPTH } from "./collision/index.ts";
import { attachInput, attachTouchInput } from "./input/index.ts";
import { scoreFor, createHighScore } from "./scoring/index.ts";
import { curve, generatorDifficulty } from "./difficulty/index.ts";
import { createAudio } from "./audio/index.ts";

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
// Difficulty is dynamic (#7): it is read from the pure difficulty curve, keyed
// on world distance. Each batch is a fair, deterministic placement sequence; we
// append the next batch (z-offset) before the player reaches the end, giving an
// endless clearable track that hardens as the run progresses. The generator
// difficulty for a batch is sampled at that batch's start z (where it will be
// played), so later track is denser/more complex.
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
  // Sample the difficulty curve at this batch's start distance and collapse its
  // density/complexity knobs into the generator's [0,1] difficulty argument.
  const batchDifficulty = generatorDifficulty(curve(batchEndZ));
  const batch = nextBatch(RUN_SEED, batchIndex, batchDifficulty, batchEndZ);
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

// --- Audio glue --------------------------------------------------------
// The procedural Web Audio engine (src/audio) owns all sound; main.ts only
// wires events to it. Per the browser autoplay policy, audio cannot start
// before a user gesture, so `audio.init()` is called on the FIRST Start-click /
// key / touch (init is idempotent, so calling it on every gesture is safe).
// Sound effects only - there is no music bed.
const audio = createAudio();
// Obstacle placements that have already fired a near-miss cue, so a single
// jumped/slid-past obstacle chirps once rather than on every frame it straddles
// the player's z-band. Cleared on restart.
const nearMissed = new Set<Placement>();
function unlockAudio(): void {
  audio.init();
}
window.addEventListener("keydown", unlockAudio);
window.addEventListener("touchstart", unlockAudio, { passive: true });

// Keyboard and touch feed the SAME intent queue, so the player `step` is driven
// identically by both. Each accepted movement intent also fires its SFX.
function pushIntent(intent: Intent): void {
  if (state.phase !== "playing") return;
  intentQueue.push(intent);
  if (intent === "left" || intent === "right") audio.sfx("lane-switch");
  else if (intent === "jump") audio.sfx("jump");
  else if (intent === "slide") audio.sfx("slide");
}

attachInput(window, pushIntent);
attachTouchInput(window, pushIntent);

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
  unlockAudio(); // first gesture: build + resume the AudioContext (autoplay-safe)
  state = begin(state);
  syncOverlays();
});

restartButton.addEventListener("click", () => {
  unlockAudio();
  state = restart(state);
  resetTrack();
  player = createInitialPlayer();
  intentQueue.length = 0;
  coins = 0;
  nearMissed.clear();
  syncOverlays();
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // Live scroll speed ramps with distance via the difficulty curve.
  state = tick(state, dt, curve(state.distance).speed);
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
      audio.sfx("coin"); // coin tally increased this frame
      const consumed = new Set(result.collected);
      track = track.filter((p) => !consumed.has(p));
    }
    // Near-miss: an obstacle the player is actively CLEARING (jumping over a low
    // obstacle, sliding under a high one) in an occupied lane within the z-band.
    // Derived from collision/player outputs only; never modifies those modules.
    // resolve() already proved this obstacle is NOT a hit (it was cleared), so a
    // chirp here is a genuine "just dodged it" cue, fired once per obstacle.
    if (player.mode === "jumping" || player.mode === "sliding") {
      const clearableType = player.mode === "jumping" ? "obstacle-low" : "obstacle-high";
      const pz = playerZ(state.distance);
      for (const p of track) {
        if (p.type !== clearableType) continue;
        if (Math.abs(p.z - pz) > HALF_DEPTH) continue; // outside the z-band
        if (p.lane !== player.lane && p.lane !== player.fromLane) continue; // not occupied
        if (nearMissed.has(p)) continue; // already chirped for this obstacle
        nearMissed.add(p);
        audio.sfx("near-miss");
      }
    }
    if (result.hit) {
      state = crash(state);
      audio.sfx("crash");
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
