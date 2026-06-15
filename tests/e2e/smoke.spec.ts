import { test, expect } from "@playwright/test";

test("page loads to a playable canvas", async ({ page }) => {
  await page.goto("/");

  // Canvas renders with real dimensions.
  const canvas = page.locator("#game-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Start overlay is shown with control hints; HUD hidden until playing.
  await expect(page.locator("#start-overlay")).toBeVisible();
  await expect(page.locator("#start-overlay .hint")).toContainText("jump");
  await expect(page.locator("#hud")).toBeHidden();

  // Begin: reaches playable state (overlay gone, HUD live, score climbs).
  await page.locator("#start-button").click();
  await expect(page.locator("#start-overlay")).toBeHidden();
  await expect(page.locator("#hud")).toBeVisible();
  await expect
    .poll(async () => Number(await page.locator("#score").textContent()))
    .toBeGreaterThan(0);

  // Real collision drives game over: with no lane input the world scrolls until
  // an obstacle/full-block reaches the player. This is deterministic (fixed
  // seed RUN_SEED=1337) and happens within a couple seconds, and the player
  // collects coins along the way (the coins HUD increments before the crash).
  await expect
    .poll(async () => Number(await page.locator("#coins").textContent()))
    .toBeGreaterThan(0);
  await expect(page.locator("#gameover-overlay")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#restart-button")).toBeVisible();

  // Game-over overlay reports a persisted high score alongside the final score.
  await expect(page.locator("#high-score")).toBeVisible();
});
