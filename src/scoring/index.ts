/**
 * Pure scoring for the runner.
 *
 * This module has NO Three.js and NO DOM dependency. It is the seam between the
 * world distance + coin tally (held as glue in src/main.ts) and what the HUD /
 * game-over overlay display. Two pieces:
 *
 *  1. `scoreFor(distance, coins)` - pure accumulation: floored distance plus a
 *     flat per-coin bonus.
 *  2. `createHighScore(storage, key)` - a persisted best backed by INJECTED
 *     storage (real `localStorage` in the app, a fake in tests).
 *
 * Decisions (per the issue brief)
 * -------------------------------
 * COIN_VALUE: each coin is worth 10 points. Coins are sparse relative to the
 * per-unit distance score, so 10 makes a single coin a meaningful but not
 * distance-dominating reward.
 *
 * HIGH_SCORE_KEY: the default localStorage key is namespaced
 * `neon-runner:highscore` to avoid clashing with anything else on the origin.
 *
 * Graceful fallback: storage can be absent (private mode) or throw on access.
 * The store NEVER propagates a storage error. A failed read is treated as 0; a
 * failed write is a no-op. The best is also held in memory, so within a session
 * submit() still tracks the running max even when persistence is unavailable.
 */

/** Points awarded per coin collected. */
export const COIN_VALUE = 10;

/** Default, namespaced localStorage key for the persisted high score. */
export const HIGH_SCORE_KEY = "neon-runner:highscore";

/** The minimal storage shape the high-score store needs (satisfied by `localStorage`). */
export interface HighScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HighScore {
  /** The current best (0 if none persisted / storage unreadable). */
  get(): number;
  /** Record a score; persist and return the new best (the max of stored and given). */
  submit(score: number): number;
}

/**
 * High-score store over INJECTED storage. Reads the persisted best lazily and
 * keeps an in-memory mirror so it degrades gracefully if storage throws.
 */
export function createHighScore(storage: HighScoreStorage, key = HIGH_SCORE_KEY): HighScore {
  function read(): number {
    try {
      const raw = storage.getItem(key);
      const value = raw === null ? 0 : Number(raw);
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  // In-memory mirror, seeded from storage, so the running max survives even when
  // persistence is unavailable.
  let best = read();

  return {
    get(): number {
      return best;
    },
    submit(score: number): number {
      if (score > best) {
        best = score;
        try {
          storage.setItem(key, String(best));
        } catch {
          // Persistence unavailable (private mode / disabled): keep the
          // in-memory best, swallow the error.
        }
      }
      return best;
    },
  };
}

/**
 * Total score = floored distance traveled + coins * COIN_VALUE. Distance is
 * floored so the HUD shows whole points; coins contribute a flat bonus.
 */
export function scoreFor(distance: number, coins: number): number {
  return Math.floor(distance) + coins * COIN_VALUE;
}
