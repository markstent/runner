/**
 * Keyboard and touch input for player movement.
 *
 * The mapping from a `KeyboardEvent.code` to a movement `Intent` is a PURE
 * function (`keyToIntent`) so it can be unit-tested without a DOM. `attachInput`
 * is a thin imperative shell that wires a real keydown listener to a sink, so
 * main.ts can feed intents into the player `step`.
 *
 * Touch is the mobile mirror of the same seam: `swipeToIntent` is a PURE swipe
 * classifier (unit-tested like `keyToIntent`), and `attachTouchInput` is the
 * thin touchstart/touchend shell that measures the gesture and feeds the same
 * intent sink. Both feed the SAME intent queue in main.ts, so the player `step`
 * is driven identically by keyboard and touch.
 */
import type { Intent } from "../player/index.ts";

/** Map a `KeyboardEvent.code` to a movement intent, or null if unmapped. */
export function keyToIntent(code: string): Intent | null {
  switch (code) {
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    case "ArrowUp":
    case "KeyW":
    case "Space":
      return "jump";
    case "ArrowDown":
    case "KeyS":
      return "slide";
    default:
      return null;
  }
}

/**
 * Attach a keydown listener that pushes each mapped intent into `onIntent`.
 * Returns a disposer that removes the listener. Thin shell over `keyToIntent`;
 * all decision logic lives in the pure mapper above.
 */
export function attachInput(
  target: Window | HTMLElement,
  onIntent: (intent: Intent) => void,
): () => void {
  const handler = (event: Event): void => {
    const intent = keyToIntent((event as KeyboardEvent).code);
    if (intent !== null) {
      event.preventDefault();
      onIntent(intent);
    }
  };
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

// --- Touch input --------------------------------------------------------
// Mobile mirror of the keyboard seam. A swipe is classified by its net travel
// (dx, dy) from touchstart to touchend; screen Y grows downward, so an upward
// swipe has a negative dy. The dominant axis wins and must itself clear the
// threshold; an exact tie favours the horizontal (lateral) move. Travel below
// the threshold is a tap, not a swipe, and maps to no intent.

/** Minimum dominant-axis travel (px) for a touch drag to count as a swipe. */
export const SWIPE_THRESHOLD = 30;

/**
 * Classify a swipe's net travel into a movement intent, or null if it is below
 * `threshold` (a tap). PURE: the touch equivalent of `keyToIntent`.
 *
 * - horizontal dominant: dx > 0 -> "right", dx < 0 -> "left"
 * - vertical dominant: dy < 0 (up) -> "jump", dy > 0 (down) -> "slide"
 * - |dx| >= |dy| breaks the tie toward the horizontal axis.
 */
export function swipeToIntent(dx: number, dy: number, threshold: number): Intent | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= ay) {
    if (ax < threshold) return null;
    return dx > 0 ? "right" : "left";
  }
  if (ay < threshold) return null;
  return dy > 0 ? "slide" : "jump";
}

/**
 * Attach touchstart/touchend listeners that classify each swipe and push the
 * resulting intent into `onIntent`. Returns a disposer. Thin shell over
 * `swipeToIntent`; all decision logic lives in the pure mapper above. Mirrors
 * `attachInput` so main.ts can wire touch to the same intent queue as keyboard.
 */
export function attachTouchInput(
  target: Window | HTMLElement,
  onIntent: (intent: Intent) => void,
  threshold: number = SWIPE_THRESHOLD,
): () => void {
  let startX = 0;
  let startY = 0;

  const onStart = (event: Event): void => {
    const touch = (event as TouchEvent).changedTouches[0];
    if (touch === undefined) return;
    startX = touch.clientX;
    startY = touch.clientY;
  };

  const onEnd = (event: Event): void => {
    const touch = (event as TouchEvent).changedTouches[0];
    if (touch === undefined) return;
    const intent = swipeToIntent(touch.clientX - startX, touch.clientY - startY, threshold);
    if (intent !== null) {
      event.preventDefault();
      onIntent(intent);
    }
  };

  target.addEventListener("touchstart", onStart, { passive: true });
  target.addEventListener("touchend", onEnd);
  return () => {
    target.removeEventListener("touchstart", onStart);
    target.removeEventListener("touchend", onEnd);
  };
}
