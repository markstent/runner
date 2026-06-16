# Neon Cyberpunk Runner

A 3D, lane-based endless runner that runs in the browser. Dodge obstacles and grab coins on a procedurally generated neon track that speeds up the longer you survive.

[![Built with Muster](https://img.shields.io/badge/built%20with-Muster-ff40c0?style=flat-square)](#built-with-muster)
[![Status](https://img.shields.io/badge/status-workflow%20experiment-20e0ff?style=flat-square)](#built-with-muster)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r169-000000?style=flat-square&logo=three.js&logoColor=white)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Vitest](https://img.shields.io/badge/tested%20with-Vitest-6e9f18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Tests](https://img.shields.io/badge/tests-111%20unit%20%2B%202%20e2e-success?style=flat-square)](#testing)
[![License: MIT](https://img.shields.io/badge/license-MIT-44cc11?style=flat-square)](LICENSE)

---

## Overview

Neon Cyberpunk Runner is a desktop-first, mobile-tolerant browser game built with [Three.js](https://threejs.org/). You control a runner on a three-lane track, switching lanes, jumping, and sliding to clear obstacles while collecting coins. One hit ends the run. The track is generated procedurally from validated chunks so it is endless yet always clearable, and a difficulty curve ramps speed and obstacle density the further you get.

The "premium" look comes from the rendering pipeline rather than heavyweight assets: dramatic lighting, a procedural environment map, bloom, depth of field, motion blur, and volumetric fog, all gated behind a quality-tier system that degrades gracefully on weaker hardware.

## Features

- **Lane-based movement** — three lanes with jump and slide, plus input buffering and coyote-time forgiveness for tight, responsive control.
- **Procedural track** — a seedable generator stitches hand-authored chunks and validates every segment against a fairness predicate, so the run is endless and never unclearable, even across batch seams and as difficulty climbs.
- **Collisions & coins** — pure collision resolution (jump clears low obstacles, slide clears high, full-blocks need a clear lane); coins are collected and scored.
- **Scoring & persistence** — score from distance + coins, with a high score persisted in `localStorage`.
- **Difficulty ramp** — a pure curve raises world speed and generator difficulty over distance, bounded and monotonic, with clearability preserved at every level.
- **Cinematic rendering** — neon-emissive materials, real-time shadows, bloom, DoF, motion blur, fog, and env-map reflections, with `low`/`medium`/`high` quality tiers.
- **Rigged avatar** — an animated glTF character driven by the player's pose, with a graceful capsule fallback while the model loads.
- **Procedural audio** — synthesized sound effects (lane-switch, coin, jump, slide, near-miss, crash) via the Web Audio API. No asset files.
- **Keyboard + touch** — full keyboard controls on desktop and swipe controls on touch devices.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move lane | `←` / `→` or `A` / `D` | Swipe left / right |
| Jump | `Space` / `W` / `↑` | Swipe up |
| Slide | `↓` / `S` | Swipe down |

Audio unlocks on your first interaction (browser autoplay policy). One obstacle hit ends the run; the game-over overlay shows your score and best.

## Getting started

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install      # install dependencies
npm run dev      # start the dev server, then open the printed http://localhost URL
```

Other scripts:

```bash
npm run build      # type-check (tsc) and produce a production build in dist/
npm run preview    # serve the production build locally
npm test           # run the Vitest unit suite
npm run test:e2e   # run the Playwright browser smoke tests
```

It is a static site — the contents of `dist/` can be served from any static host.

## Architecture

The codebase deliberately separates **pure game logic** (framework-free, exhaustively unit-tested) from a **thin Three.js rendering layer**. This is what makes the logic testable without a GPU and keeps the rendering swappable.

```
src/
  game/        state machine (start | playing | gameOver) + pure world tick
  track/       chunk catalog, seedable generator, fairness validator (isClearable)
  player/      movement state machine: lanes, jump, slide, buffering, coyote time
  collision/   pure resolver: player pose + nearby placements -> hit / coins
  scoring/     score accumulation + localStorage-backed high score
  difficulty/  pure curve: distance -> { speed, density, complexity }
  input/       pure keyboard + swipe -> intent mapping
  audio/       procedural Web Audio engine (SFX)
  render/      Three.js scene, post-processing pipeline, quality tiers, avatar
  main.ts      composition root: wires the pure modules into the render loop
```

The render contract (`createScene(canvas) -> { render, resize, domElement }`) and the player's `pose()` projection are the seams that let the visual layer evolve without touching gameplay.

## Testing

Pure modules are unit-tested directly with [Vitest](https://vitest.dev/); the integrated game is covered by a [Playwright](https://playwright.dev/) browser smoke test.

- **111 unit tests** across game state, track generation & fairness (including a clearability invariant over hundreds of seeds × difficulties), movement, collision, scoring, difficulty, input, audio, and the quality-tier selector.
- **2 end-to-end tests** asserting the page loads to a playable canvas, a real collision reaches game-over, and touch + audio initialization keep the game running with no console errors.

```bash
npm test && npm run test:e2e
```

## Built with Muster

This project is an **experiment in agentic development workflow**. Rather than being written ad hoc, every line was produced through **Muster** — a structured, multi-stage workflow (a Claude Code command plugin) for building software with AI agents under human approval gates.

> Replace this line with a link to the Muster repository you used.

The whole game went through the Muster pipeline:

1. **`/think`** — an interview that interrogated the idea until every branch of the decision tree was resolved (genre, art direction, scope, the riskiest assumptions).
2. **`/spec`** — turned the resolved idea into a single spec file and a set of independently buildable task issues.
3. **`/triage`** — a manager role that assessed each task's risk, checked dependencies, and decided what was safe for an autonomous agent to pick up.
4. **`/build`** — a worker-coordinator role that spawned sub-agents to implement each task with TDD, then ran an automatic two-axis **inner review** (Standards + Spec) on every diff before presenting it for sign-off.
5. **`/review`** — a final pre-merge two-axis review of each pull request.

Nothing was auto-merged: every task was built on its own branch, reviewed, and merged only on explicit human approval. The full history lives in the project's issues and pull requests (#10–#20).

A few consequences of building this way are visible in the design:

- Game logic is split into small, pure, individually testable modules because the workflow tests behaviour through public seams.
- The difficulty generator's fairness invariant is proven by property tests over many seeds, because "procedurally generated *and always fair*" was identified during `/think` as the riskiest engineering assumption.
- The rigged avatar loads behind a placeholder fallback, and audio is fully procedural — both chosen so the build was never blocked on sourcing external assets.

## Notes & follow-ups

- The avatar uses a single animation clip driven as the run loop; distinct run/jump/slide/death clips would need a multi-clip rigged model.
- Audio is procedural sound effects only (no music bed).
- Tracked follow-ups: dispose render/avatar resources on teardown, make difficulty's density and complexity independent knobs, and disconnect spent SFX nodes for symmetry.

## License

Released under the [MIT License](LICENSE).
