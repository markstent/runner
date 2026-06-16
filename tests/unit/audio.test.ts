import { describe, it, expect, vi } from "vitest";
import { createAudio, SFX_NAMES, type AudioContextLike } from "../../src/audio/index.ts";

/**
 * A minimal mock of the Web Audio surface the engine uses. Records every node
 * created and every start/stop, so tests assert behaviour through the public
 * API without any real sound. This is the audio module's injected seam.
 */
function makeMockContext() {
  const started: string[] = [];
  const stopped: string[] = [];
  const created: string[] = [];
  let resumed = 0;

  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });

  const makeNode = () => ({
    gain: param(),
    connect: vi.fn(() => makeNode()),
    disconnect: vi.fn(),
  });

  const makeOsc = () => {
    created.push("oscillator");
    return {
      type: "sine",
      frequency: param(),
      detune: param(),
      connect: vi.fn(() => makeNode()),
      start: vi.fn(() => started.push("oscillator")),
      stop: vi.fn(() => stopped.push("oscillator")),
      disconnect: vi.fn(),
    };
  };

  const makeBufferSource = () => {
    created.push("bufferSource");
    return {
      buffer: null,
      loop: false,
      connect: vi.fn(() => makeNode()),
      start: vi.fn(() => started.push("bufferSource")),
      stop: vi.fn(() => stopped.push("bufferSource")),
      disconnect: vi.fn(),
    };
  };

  const ctx: AudioContextLike & {
    _started: string[];
    _stopped: string[];
    _created: string[];
    _resumeCount: () => number;
  } = {
    currentTime: 0,
    state: "running",
    destination: {} as AudioDestinationNode,
    createOscillator: vi.fn(makeOsc) as unknown as AudioContextLike["createOscillator"],
    createGain: vi.fn(makeNode) as unknown as AudioContextLike["createGain"],
    createBufferSource:
      vi.fn(makeBufferSource) as unknown as AudioContextLike["createBufferSource"],
    createBuffer: vi.fn(() => ({
      getChannelData: () => new Float32Array(16),
    })) as unknown as AudioContextLike["createBuffer"],
    resume: vi.fn(async () => {
      resumed++;
    }) as unknown as AudioContextLike["resume"],
    _started: started,
    _stopped: stopped,
    _created: created,
    _resumeCount: () => resumed,
  };
  return ctx;
}

describe("audio engine", () => {
  it("does not create a context until init() (lazy on first gesture)", () => {
    const factory = vi.fn(() => makeMockContext());
    createAudio(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it("creates the context on init() and resumes it (unblocks autoplay)", () => {
    const ctx = makeMockContext();
    const factory = vi.fn(() => ctx);
    const audio = createAudio(factory);
    audio.init();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(ctx._resumeCount()).toBe(1);
  });

  it("is idempotent: repeated init() does not recreate the context", () => {
    const factory = vi.fn(() => makeMockContext());
    const audio = createAudio(factory);
    audio.init();
    audio.init();
    audio.init();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("does not throw when sfx is called before init (no-op)", () => {
    const ctx = makeMockContext();
    const audio = createAudio(() => ctx);
    expect(() => audio.sfx("coin")).not.toThrow();
    expect(ctx._created).toHaveLength(0);
  });

  it("fires an audio node for every named SFX after init", () => {
    for (const name of SFX_NAMES) {
      const ctx = makeMockContext();
      const audio = createAudio(() => ctx);
      audio.init();
      const startsBefore = ctx._started.length;
      audio.sfx(name);
      expect(
        ctx._started.length,
        `sfx("${name}") should start at least one node`,
      ).toBeGreaterThan(startsBefore);
    }
  });

  it('sfx("coin") creates and starts an oscillator', () => {
    const ctx = makeMockContext();
    const audio = createAudio(() => ctx);
    audio.init();
    audio.sfx("coin");
    expect(ctx._created).toContain("oscillator");
    expect(ctx._started).toContain("oscillator");
  });

  it("ignores an unknown sfx name without throwing", () => {
    const ctx = makeMockContext();
    const audio = createAudio(() => ctx);
    audio.init();
    // @ts-expect-error - exercising the runtime guard for an unknown name.
    expect(() => audio.sfx("nope")).not.toThrow();
  });
});
