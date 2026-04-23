import { expect, test } from "@playwright/test";
import { buildAuthState, clearAuth, seedAuth, stubTelemetry } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await stubTelemetry(page);
});

test("redirects unauthenticated users from protected routes to login", async ({ page }) => {
  await clearAuth(page);

  await page.goto("/map");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("keeps platform owner routes owner-only and falls back to map", async ({ page }) => {
  await seedAuth(
    page,
    buildAuthState({
      role: "admin",
      platformRole: "platform_support",
      isPlatformOwner: false
    })
  );

  await page.route("**/api/map/properties**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });
  await page.route("**/api/routes/active", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null"
    });
  });

  await page.goto("/platform");

  await expect(page).toHaveURL(/\/map(\?team=1)?$/);
});
