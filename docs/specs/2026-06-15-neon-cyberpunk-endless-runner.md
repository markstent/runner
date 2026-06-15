# Spec: Neon Cyberpunk Endless Runner

## Problem
I need a portfolio piece that lands with both frontend employers and game studios. It has to prove engineering craft (clean code, a steady 60fps, no jank) and game feel (tight, responsive controls) in one artifact that loads instantly in any browser. The bar is the "5-second wow": someone opening it cold reacts to how it looks and feels before they have even finished the first dodge.

## Solution
A 3D, lane-based endless runner set in a neon cyberpunk night. The player runs forward on a procedurally generated track, switching between three lanes and using jump and slide to dodge obstacles while collecting coins for score. One hit ends the run. The world is built by stitching pre-validated "chunks" so the track is endless yet always clearable as it speeds up. Premium look comes from a cinematic rendering pipeline (dramatic lighting, real-time shadows, volumetric fog, bloom, reflections, motion blur) over stylized-but-believable geometry, not from heavyweight photoreal assets. Desktop keyboard is the primary, fully-tuned experience; mobile is a graceful fallback with touch controls and reduced effects.

## Test seams
The game splits into pure, framework-free logic modules and a thin Three.js rendering layer. Pure modules are the primary seams, unit-tested directly with Vitest, no GPU required:
- `src/track/` - chunk catalog, seedable stitcher, fairness validator. Seam: `generate(seed, difficulty)` returns a deterministic, always-clearable sequence of obstacle/coin placements. Tested by asserting clearability invariants over many seeds.
- `src/player/` - movement state machine. Seam: `step(state, input, dt)` returns next state. Tested for lane transitions, jump/slide windows, input buffering, coyote time. No Three.js.
- `src/collision/` - resolution. Seam: pure function from (player pose, world entities at z) to `{hit, coinsCollected}`. Tested with hand-built scenarios.
- `src/scoring/` - score and persistence. Seam: pure score accumulation + a `localStorage`-backed high-score store (injectable storage for tests).
- `src/difficulty/` - ramp curve. Seam: pure function from distance/time to `{speed, density, complexity}`. Tested for monotonic, bounded ramp.
- `src/game/` - the game-state/overlay machine (start -> playing -> game-over -> restart) and a headless `tick(dt)` world step that drives the above. Seam: state machine unit-tested; `tick` testable without rendering.

The integrated game (rendering, input, audio) is covered by one Playwright smoke test: page loads to playable under the time budget, canvas renders, a sampled frame rate stays at/above target on desktop, and the start -> play -> game-over -> restart loop is reachable.

## Done when
- [ ] Page loads to playable in under ~3 seconds on a normal connection, with no visible asset pop-in once running.
- [ ] Holds 60fps on desktop during continuous play with the full post-processing pipeline enabled; degrades gracefully (reduced effects, no crash) on mobile.
- [ ] Lane-switch, jump, and slide respond on the same frame as input - no perceptible latency.
- [ ] A continuous 2+ minute run never presents an unclearable obstacle combination as speed ramps (fairness invariant holds across seeds in tests).
- [ ] The piece produces a visible "wow" on first sight: cinematic neon lighting, bloom, fog, reflections, motion blur all present and coherent.
- [ ] Full loop works cleanly: start overlay -> play (dodge + collect coins) -> one-hit crash -> game-over overlay with score and persisted local high score -> restart.
- [ ] Music loop and SFX (lane-switch, coin, jump, near-miss, crash) fire correctly, starting on first user interaction.
- [ ] Playable on touch (swipe lane-switch / swipe-up jump / swipe-down slide) with graceful quality downgrade; never looks broken on a phone.

## Out of scope
- No backend, accounts, or server. Static site only.
- No global/online leaderboard. Local high score in `localStorage` only.
- No power-ups, upgrades, or shop.
- One world/theme only. No multiple themes or levels.
- No character customization or narrative.
- No tutorial screen. Controls are shown on the start overlay.
- No bespoke character modeling or hand-rigging. Use a pre-rigged (Mixamo-style) humanoid with ready-made run/jump/slide/death clips, restyled to fit the theme.

## Touches
- `package.json`, `vite.config.ts`, `tsconfig.json` (new project scaffold)
- `index.html`, `src/main.ts` (entry + canvas + overlays)
- `src/game/` (state machine, world tick)
- `src/track/` (chunk catalog, stitcher, fairness validator)
- `src/player/` (movement state machine)
- `src/collision/` (collision + coin resolution)
- `src/scoring/` (score + high-score persistence)
- `src/difficulty/` (ramp curve)
- `src/render/` (Three.js scene, camera, lighting, post-processing pipeline)
- `src/input/` (keyboard + touch)
- `src/audio/` (music + SFX)
- `tests/` (Vitest unit, Playwright smoke)

---

## Tasks

### Task 1 - Scaffold the project and stand up the rendering spine
**What:** Set up Vite + TypeScript + Three.js + Vitest + Playwright. Render a lit cyberpunk ground plane scrolling toward a fixed chase camera at 60fps, with the game-state/overlay machine (start -> playing -> game-over -> restart) and a score/coins HUD shell driven by a headless `tick(dt)`.
**Why:** Establishes the "loads to playable" and "60fps render loop" done-criteria and the seams every other task builds against.
**Acceptance:**
- [ ] `npm run dev`, `npm run build`, and `npm test` all work; CI-runnable test command exists.
- [ ] `src/game/` exposes a state machine (`start | playing | gameOver`) with transitions `begin()`, `crash()`, `restart()` and a pure `tick(dt)` that advances world distance.
- [ ] On screen: a scrolling lit plane toward the camera, a start overlay with control hints, a live score/coins HUD, and a game-over overlay with a restart control.
- [ ] Tests written for all new behaviour, through the seam above (state machine + `tick` unit-tested in Vitest; Playwright smoke test asserts the page loads to playable and the canvas renders).
- [ ] Full test suite passes
**Scope:** touch only scaffold files, `index.html`, `src/main.ts`, `src/game/`, `src/render/` (minimal scene), `tests/`; do not implement gameplay, generation, audio, or post-processing yet.

### Task 2 - Generate a fair, endless procedural track from chunks
**What:** Build the chunk catalog, a seedable stitcher that produces an endless obstacle/coin layout, and a fairness validator guaranteeing every stitched track is clearable at the given difficulty. Spawn the resulting obstacle and coin geometry into the scrolling world.
**Why:** Satisfies the "2+ minute run with no unclearable combination" done-criterion and the endless-track requirement.
**Acceptance:**
- [ ] `src/track/` exposes `generate(seed, difficulty)` returning a deterministic sequence of placements (lane, z, type: obstacle-low/obstacle-high/full-block/coin).
- [ ] A fairness validator rejects any chunk or stitched segment that leaves no clearable path at the configured speed; exposed as a pure predicate.
- [ ] Generated obstacles and coins appear as themed meshes in the moving world, recycled as they pass the camera.
- [ ] Tests written for all new behaviour, through the seam above (clearability invariant asserted across many seeds and difficulty levels; determinism for a fixed seed).
- [ ] Full test suite passes
**Scope:** touch only `src/track/` and the world-population glue in `src/render/`/`src/game/`; do not touch player, collision, scoring, difficulty curve, audio, or post-processing.

### Task 3 - Implement responsive player movement with animation
**What:** Build the player movement state machine (3-lane switch, jump, slide, with input buffering and coyote time) and bind keyboard input, driving a pre-rigged humanoid avatar whose run/jump/slide/death clips blend smoothly on screen.
**Why:** Satisfies the "same-frame input response" and core game-feel done-criteria.
**Acceptance:**
- [ ] `src/player/` exposes `step(state, input, dt)` covering lane transitions, jump arc, slide duration, input buffering, and coyote time, with no Three.js dependency.
- [ ] `src/input/` maps keyboard (arrows/WASD + space/down) to movement intents consumed by `step`.
- [ ] On screen: the avatar switches lanes, jumps, and slides with blended animation clips; movement reacts on the same frame as input.
- [ ] Tests written for all new behaviour, through the seam above (state transitions, buffering, and coyote-time windows unit-tested in Vitest).
- [ ] Full test suite passes
**Scope:** touch only `src/player/`, `src/input/` (keyboard), and avatar wiring in `src/render/`; do not touch track generation, collision, scoring, difficulty, audio, or touch input.

### Task 4 - Resolve collisions and coin collection
**What:** Implement collision resolution as a pure function from player pose (lane + vertical state) and nearby world entities to a hit/coin-collected result, then wire it so an obstacle hit triggers `crash()` and a coin overlaps add to the run.
**Why:** Satisfies the one-hit-death loop and coin-collection done-criteria.
**Acceptance:**
- [ ] `src/collision/` exposes a pure resolver: given player pose and entities at the player's z-band, returns `{hit, coinsCollected}`.
- [ ] Jumping clears low obstacles; sliding clears high obstacles; full-blocks require a clear lane; coins in the player's lane/pose are collected.
- [ ] Integrated: a hit transitions the game to `gameOver`; collected coins are removed from the world and counted.
- [ ] Tests written for all new behaviour, through the seam above (hand-built scenarios covering each obstacle type and coin pickup, hit and no-hit cases).
- [ ] Full test suite passes
**Scope:** touch only `src/collision/` and the resolve-call glue in `src/game/`; do not touch generation internals, movement internals, scoring math, difficulty, audio, or rendering polish.

### Task 5 - Score the run and persist a local high score
**What:** Accumulate score from distance traveled plus coins collected, display it live in the HUD, and persist a high score across sessions via `localStorage`, shown on the game-over overlay.
**Why:** Satisfies the score and persisted-high-score done-criteria and adds the replay hook.
**Acceptance:**
- [ ] `src/scoring/` exposes pure score accumulation (distance + coins) and a high-score store backed by injectable storage (real `localStorage` in app, fake in tests).
- [ ] Live score and coin count update in the HUD during play.
- [ ] Game-over overlay shows final score and the persisted high score; a new best updates and survives reload.
- [ ] Tests written for all new behaviour, through the seam above (accumulation math; high-score read/write/update with a fake storage).
- [ ] Full test suite passes
**Scope:** touch only `src/scoring/` and HUD/overlay glue in `src/game/`/`src/main.ts`; do not touch generation, movement, collision, difficulty, audio, or rendering.

### Task 6 - Ramp difficulty by speed, density, and complexity
**What:** Implement the difficulty curve as a pure function from run distance/time to `{speed, density, complexity}`, and feed it into world scroll speed and the track generator so the run gets harder, gradually and fairly.
**Why:** Satisfies the difficulty-ramp aspect of the "2+ minute, always fair" done-criterion.
**Acceptance:**
- [ ] `src/difficulty/` exposes a pure function from distance/time to a bounded, monotonic-where-intended `{speed, density, complexity}`.
- [ ] World scroll speed and generator difficulty read from this curve; obstacle density and pattern complexity visibly increase over a run.
- [ ] Ramp stays within the fairness validator's clearable bounds at all speeds.
- [ ] Tests written for all new behaviour, through the seam above (curve monotonicity/bounds; generated tracks remain clearable across the full ramp range).
- [ ] Full test suite passes
**Scope:** touch only `src/difficulty/` and the speed/difficulty wiring in `src/game/`/`src/track/` callsites; do not touch movement, collision, scoring, audio, or rendering polish.

### Task 7 - Build the cinematic rendering pipeline
**What:** Apply the neon-cyberpunk look: dramatic lighting, real-time shadows, themed PBR/emissive materials, volumetric fog, bloom, reflections, motion blur, and depth of field, with a quality-tier system that downgrades effects gracefully on weaker/mobile GPUs while holding the desktop frame budget.
**Why:** Satisfies the "5-second wow", "60fps with post-processing", and "graceful mobile downgrade" done-criteria.
**Acceptance:**
- [ ] Post-processing stack (bloom, fog, motion blur, DoF, reflections) and lighting are present and coherent in the neon-cyberpunk theme.
- [ ] A quality-tier selector reduces or disables effects on constrained devices without crashing; desktop holds the 60fps budget during play.
- [ ] No visible asset pop-in once running; load-to-playable budget preserved.
- [ ] Tests written for all new behaviour, through the seam above (quality-tier selection logic unit-tested; Playwright smoke samples desktop frame rate at/above target with the pipeline enabled).
- [ ] Full test suite passes
**Scope:** touch only `src/render/` (lighting, materials, post-processing, quality tiers); do not change game logic seams (track, player, collision, scoring, difficulty) or audio.

### Task 8 - Add audio and touch controls
**What:** Add a synthwave music loop and SFX (lane-switch, coin, jump, near-miss, crash) starting on first user interaction, plus touch/swipe controls (swipe lane-switch, swipe-up jump, swipe-down slide) so the game is fully playable on mobile.
**Why:** Satisfies the audio and "playable on touch" done-criteria.
**Acceptance:**
- [ ] `src/audio/` plays a looping music track and fires each SFX on its event; audio initializes on first user gesture (no autoplay-block errors).
- [ ] `src/input/` (touch) maps swipe gestures to the same movement intents as keyboard, consumed by the existing player `step`.
- [ ] The full loop is playable end-to-end on a touch device.
- [ ] Tests written for all new behaviour, through the seam above (swipe-to-intent mapping unit-tested; audio event triggering verified via the audio module's public API with a mock sink).
- [ ] Full test suite passes
**Scope:** touch only `src/audio/` and the touch half of `src/input/`; do not change game logic seams, keyboard input, or rendering internals.
