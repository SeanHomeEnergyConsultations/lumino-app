import { expect, test } from "@playwright/test";
import { buildAuthState, seedAuth, stubTelemetry } from "./support/auth";
import { buildLeadDetail, buildMapProperty, buildPropertyDetail } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await stubTelemetry(page);
  await seedAuth(page, buildAuthState());
});

test("loads the map and opens property memory from the results list", async ({ page }) => {
  await page.route("**/api/map/properties**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [buildMapProperty()]
      })
    });
  });
  await page.route("**/api/routes/active", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "null"
    });
  });
  await page.route("**/api/properties/property_1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: buildPropertyDetail()
      })
    });
  });

  await page.goto("/map");

  await page.getByRole("button", { name: /Show property list/i }).click();
  const visiblePropertyRow = page.locator("button:visible").filter({ hasText: "17 Summer St" }).first();
  await expect(visiblePropertyRow).toBeVisible();
  await visiblePropertyRow.click();

  await expect(page).toHaveURL(/propertyId=property_1/);
  await expect(page.getByRole("heading", { name: "17 Summer St" })).toBeVisible();
  await expect(page.getByText("Property Memory").first()).toBeVisible();
});

test("saves lead edits from the detail page", async ({ page }) => {
  let leadRecord = buildLeadDetail();
  let savedPayload: Record<string, unknown> | null = null;

  await page.route("**/api/leads/lead_1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        item: leadRecord
      })
    });
  });
  await page.route("**/api/leads", async (route) => {
    savedPayload = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    leadRecord = buildLeadDetail({
      ...leadRecord,
      notes: savedPayload.notes ?? leadRecord.notes,
      firstName: savedPayload.firstName ?? leadRecord.firstName
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        leadId: "lead_1"
      })
    });
  });

  await page.goto("/leads/lead_1");

  const leadNotesField = page.locator("form").filter({ hasText: "Edit lead" }).getByLabel("Notes");
  await leadNotesField.fill("Updated from playwright");
  await page.getByRole("button", { name: "Save Lead" }).click();

  await expect.poll(() => savedPayload?.notes).toBe("Updated from playwright");
  await expect(leadNotesField).toHaveValue("Updated from playwright");
});
