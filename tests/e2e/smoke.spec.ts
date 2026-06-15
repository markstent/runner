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

  // Game-over overlay with a restart control is reachable.
  await page.evaluate(() => (window as unknown as { __crash: () => void }).__crash());
  await expect(page.locator("#gameover-overlay")).toBeVisible();
  await expect(page.locator("#restart-button")).toBeVisible();
});
