/**
 * Keyboard input for player movement.
 *
 * The mapping from a `KeyboardEvent.code` to a movement `Intent` is a PURE
 * function (`keyToIntent`) so it can be unit-tested without a DOM. `attachInput`
 * is a thin imperative shell that wires a real keydown listener to a sink, so
 * main.ts can feed intents into the player `step`. Keyboard only - touch input
 * is a separate task and out of scope here.
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
