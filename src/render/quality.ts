/**
 * Quality-tier selection: a PURE, GPU-free policy that maps coarse device
 * capabilities to a tier. Kept separate from scene.ts so it is unit-testable
 * without a real WebGL context. scene.ts reads TIER_SETTINGS to decide which
 * post-processing passes to enable and at what internal resolution.
 */

export type QualityTier = "low" | "medium" | "high";

/**
 * Coarse, plain-object device capabilities. All fields optional so callers can
 * pass whatever they could probe; missing fields degrade safely toward "low".
 * - devicePixelRatio: window.devicePixelRatio (a cost signal at high values).
 * - maxTextureSize: gl.getParameter(MAX_TEXTURE_SIZE) (a rough GPU-class proxy).
 * - lowPower: a mobile / low-power hint (e.g. coarse pointer + no hover, or a
 *   `powerPreference: "low-power"` context, or a UA mobile match).
 */
export interface DeviceCaps {
  devicePixelRatio?: number;
  maxTextureSize?: number;
  lowPower?: boolean;
}

export interface TierSettings {
  /** Internal render resolution multiplier (composer + renderer). */
  renderScale: number;
  bloom: boolean;
  /** Cheap accumulation-buffer motion blur (AfterimagePass). */
  motionBlur: boolean;
  /** Bokeh depth of field. */
  depthOfField: boolean;
  /** Reflective floor approximation via an environment map. */
  reflections: boolean;
  /** Real-time shadow maps. */
  shadows: boolean;
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  low: {
    renderScale: 0.75,
    bloom: false,
    motionBlur: false,
    depthOfField: false,
    reflections: false,
    shadows: false,
  },
  medium: {
    renderScale: 1,
    bloom: true,
    motionBlur: false,
    depthOfField: false,
    reflections: true,
    shadows: false,
  },
  high: {
    renderScale: 1,
    bloom: true,
    motionBlur: true,
    depthOfField: true,
    reflections: true,
    shadows: true,
  },
};

// A GPU below this MAX_TEXTURE_SIZE is treated as weak/old -> low tier.
const WEAK_TEXTURE_SIZE = 4096;
// Need at least this texture budget to qualify for the high tier.
const HIGH_TEXTURE_SIZE = 16384;
// Above this DPR the per-pixel cost is high enough that we avoid the high tier
// unless the GPU is clearly strong (handled together with texture size below).
const COSTLY_DPR = 2;

/**
 * Map device capabilities to a quality tier. Conservative by design: any strong
 * "this is constrained" signal (low-power hint, weak GPU, unknown caps) lands on
 * "low"; "high" requires a clearly capable GPU and a non-punishing pixel cost.
 */
export function selectQualityTier(caps: DeviceCaps): QualityTier {
  const dpr = caps.devicePixelRatio ?? 0;
  const maxTexture = caps.maxTextureSize ?? 0;
  const lowPower = caps.lowPower ?? false;

  // Hard downgrades.
  if (lowPower) return "low";
  if (maxTexture < WEAK_TEXTURE_SIZE) return "low";

  // High tier: a big-texture GPU at a sane pixel cost.
  if (maxTexture >= HIGH_TEXTURE_SIZE && dpr <= COSTLY_DPR) return "high";

  // Everything else capable enough to run effects but not top-tier.
  return "medium";
}
