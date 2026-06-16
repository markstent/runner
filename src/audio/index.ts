/**
 * Procedural Web Audio engine for the runner.
 *
 * Everything here is GENERATED with the Web Audio API - there are no external
 * audio files. SFX are short oscillator/noise blips; the music bed is a small
 * looping synthwave-style arpeggio over a sustained pad. This keeps the game
 * on-theme and fully self-contained.
 *
 * Design / testability
 * --------------------
 * The engine is a closure factory: `createAudio(ctxFactory?)` returns a small
 * public API `{ init, startMusic, stopMusic, sfx }`. The AudioContext is the
 * single injected seam: the factory defaults to the real `AudioContext`, but a
 * unit test passes a mock that records node creation and start/stop calls, so
 * the engine's behaviour is verified WITHOUT producing real sound.
 *
 * Autoplay policy
 * ---------------
 * Browsers block audio until a user gesture. So nothing is created in
 * `createAudio`; the AudioContext is built and `resume()`d lazily on the FIRST
 * `init()` call (wired in main.ts to the first Start-click / key / touch).
 * `init()` is idempotent. Any sound call before `init()` is a safe no-op rather
 * than an error, so wiring order can never throw.
 */

/** The subset of the Web Audio surface this engine depends on. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioDestinationNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  resume(): Promise<void>;
}

/** Factory for an AudioContext-like object (injectable for tests). */
export type AudioContextFactory = () => AudioContextLike;

/**
 * The SFX this engine can fire, one per game event. The five required by the
 * spec (lane-switch, coin, jump, near-miss, crash) plus "slide", which main.ts
 * fires on a slide intent to mirror the jump cue.
 */
export const SFX_NAMES = ["lane-switch", "coin", "jump", "slide", "near-miss", "crash"] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Public engine API returned by `createAudio`. */
export interface AudioEngine {
  /** Lazily build + resume the AudioContext on the first user gesture. Idempotent. */
  init(): void;
  /** Start the looping music bed (idempotent - one loop at a time). */
  startMusic(): void;
  /** Stop the looping music bed if running. */
  stopMusic(): void;
  /** Fire a one-shot sound effect by name. No-op before init / unknown name. */
  sfx(name: SfxName): void;
}

/** Default factory: the real browser AudioContext (with webkit fallback). */
function defaultFactory(): AudioContextLike {
  const Ctor =
    (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (Ctor === undefined) throw new Error("Web Audio API is not available");
  return new Ctor() as unknown as AudioContextLike;
}

/** A short oscillator blip with an exponential decay envelope. */
function blip(
  ctx: AudioContextLike,
  out: GainNode,
  type: OscillatorType,
  startHz: number,
  endHz: number,
  duration: number,
  peak: number,
): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startHz, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** A short filtered-noise burst (used for the crash) via a one-shot buffer. */
function noiseBurst(ctx: AudioContextLike, out: GainNode, duration: number, peak: number): void {
  const t = ctx.currentTime;
  const sampleRate = 44100;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length); // decaying noise
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  src.connect(gain).connect(out);
  src.start(t);
  src.stop(t + duration + 0.02);
}

/** Render each SFX from primitive generators. Keyed by name. */
const SFX_RENDERERS: Record<SfxName, (ctx: AudioContextLike, out: GainNode) => void> = {
  "lane-switch": (ctx, out) => blip(ctx, out, "triangle", 320, 480, 0.08, 0.25),
  coin: (ctx, out) => {
    // Two rising blips - the classic pickup chirp.
    blip(ctx, out, "square", 880, 1320, 0.07, 0.22);
    blip(ctx, out, "square", 1320, 1760, 0.07, 0.18);
  },
  jump: (ctx, out) => blip(ctx, out, "sine", 220, 660, 0.18, 0.28),
  slide: (ctx, out) => blip(ctx, out, "sine", 520, 180, 0.18, 0.24),
  "near-miss": (ctx, out) => blip(ctx, out, "sawtooth", 700, 260, 0.16, 0.2),
  crash: (ctx, out) => {
    blip(ctx, out, "sawtooth", 180, 40, 0.4, 0.32);
    noiseBurst(ctx, out, 0.4, 0.3);
  },
};

/** A simple synthwave-style loop: an arpeggio over a sustained low pad. */
function buildMusic(ctx: AudioContextLike, out: GainNode): { stop(): void } {
  const t = ctx.currentTime;
  const nodes: { stop(when: number): void; disconnect(): void }[] = [];

  // Sustained pad: two detuned saws an octave apart for the synthwave bed.
  for (const [hz, detune] of [
    [110, -6],
    [220, 6],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hz, t);
    osc.detune.setValueAtTime(detune, t);
    gain.gain.setValueAtTime(0.06, t);
    osc.connect(gain).connect(out);
    osc.start(t);
    nodes.push(osc);
  }

  // Arpeggio: a looping bandsource that retriggers an osc would be heavier than
  // we need for a "simple generated loop", so use one osc whose frequency steps
  // through an A-minor-ish pattern; the loop is the periodic schedule itself.
  const arp = ctx.createOscillator();
  const arpGain = ctx.createGain();
  arp.type = "triangle";
  arpGain.gain.setValueAtTime(0.08, t);
  arp.connect(arpGain).connect(out);
  const pattern = [440, 523.25, 659.25, 523.25]; // A, C, E, C
  const step = 0.25;
  const bars = 64; // ~16s of schedule before it would need a refill; loops audibly
  for (let i = 0; i < bars; i++) {
    arp.frequency.setValueAtTime(pattern[i % pattern.length], t + i * step);
  }
  arp.start(t);
  nodes.push(arp);

  return {
    stop() {
      const now = ctx.currentTime;
      for (const n of nodes) {
        try {
          n.stop(now);
        } catch {
          // already stopped - ignore
        }
        n.disconnect();
      }
    },
  };
}

/**
 * Create the audio engine. `ctxFactory` is the injectable AudioContext seam;
 * it defaults to the real browser AudioContext and is replaced with a mock in
 * tests so behaviour is asserted without real sound.
 */
export function createAudio(ctxFactory: AudioContextFactory = defaultFactory): AudioEngine {
  let ctx: AudioContextLike | null = null;
  let master: GainNode | null = null;
  let music: { stop(): void } | null = null;

  function init(): void {
    if (ctx !== null) return; // idempotent
    ctx = ctxFactory();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    // Unblock the autoplay policy; resume is a no-op if already running.
    void ctx.resume();
  }

  function startMusic(): void {
    if (ctx === null || master === null) return; // not initialised yet
    if (music !== null) return; // already playing - one loop at a time
    music = buildMusic(ctx, master);
  }

  function stopMusic(): void {
    if (music === null) return;
    music.stop();
    music = null;
  }

  function sfx(name: SfxName): void {
    if (ctx === null || master === null) return; // not initialised yet
    const render = SFX_RENDERERS[name];
    if (render === undefined) return; // unknown name - ignore
    render(ctx, master);
  }

  return { init, startMusic, stopMusic, sfx };
}
