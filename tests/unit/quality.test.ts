import { describe, it, expect } from "vitest";
import { selectQualityTier, TIER_SETTINGS, type DeviceCaps } from "../../src/render/quality.ts";

// A capable desktop GPU: high DPR, large textures, mains-powered.
const DESKTOP: DeviceCaps = {
  devicePixelRatio: 2,
  maxTextureSize: 16384,
  lowPower: false,
};

describe("selectQualityTier", () => {
  it("maps a capable desktop to the high tier", () => {
    expect(selectQualityTier(DESKTOP)).toBe("high");
  });

  it("maps an explicit low-power / mobile hint to the low tier", () => {
    expect(selectQualityTier({ ...DESKTOP, lowPower: true })).toBe("low");
  });

  it("maps a small max texture size (weak GPU) to the low tier", () => {
    expect(selectQualityTier({ ...DESKTOP, maxTextureSize: 2048 })).toBe("low");
  });

  it("maps a mid-range GPU to the medium tier", () => {
    expect(
      selectQualityTier({ devicePixelRatio: 1, maxTextureSize: 8192, lowPower: false }),
    ).toBe("medium");
  });

  it("falls back to low when capabilities are unknown/empty", () => {
    expect(selectQualityTier({})).toBe("low");
  });

  it("treats a very high DPR as a cost signal, capping at medium without a big GPU", () => {
    // High DPR but only a mid-range texture budget: do not promote to high.
    expect(
      selectQualityTier({ devicePixelRatio: 3, maxTextureSize: 8192, lowPower: false }),
    ).not.toBe("high");
  });

  it("each tier has a settings entry describing which passes are enabled", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const s = TIER_SETTINGS[tier];
      expect(typeof s.bloom).toBe("boolean");
      expect(typeof s.motionBlur).toBe("boolean");
      expect(typeof s.depthOfField).toBe("boolean");
      expect(typeof s.reflections).toBe("boolean");
      expect(typeof s.shadows).toBe("boolean");
      expect(s.renderScale).toBeGreaterThan(0);
      expect(s.renderScale).toBeLessThanOrEqual(1);
    }
  });

  it("disables shadows and motion blur on the low tier but keeps them on high", () => {
    expect(TIER_SETTINGS.low.shadows).toBe(false);
    expect(TIER_SETTINGS.low.motionBlur).toBe(false);
    expect(TIER_SETTINGS.high.shadows).toBe(true);
    expect(TIER_SETTINGS.high.motionBlur).toBe(true);
  });
});
