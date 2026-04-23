import { expect, test } from "@playwright/test";
import { clearAuth, stubTelemetry } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await stubTelemetry(page);
  await clearAuth(page);
});

test("books a public QR appointment through the live booking flow", async ({ page }) => {
  let submittedBooking: Record<string, unknown> | null = null;

  await page.route("**/api/public/qr/e2e-booking/availability**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        bookingTypeId: "consult_in_person",
        timezone: "America/New_York",
        appointmentType: "in_person_consult",
        appointmentTypeLabel: "Home Consult",
        days: [
          {
            dateKey: "2026-05-06",
            dateLabel: "Wednesday, May 6",
            slots: [
              { startAt: "2026-05-06T13:00:00.000Z", label: "9:00 AM" },
              { startAt: "2026-05-06T15:00:00.000Z", label: "11:00 AM" }
            ]
          }
        ]
      })
    });
  });
  await page.route("**/api/public/qr/e2e-booking/book", async (route) => {
    submittedBooking = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true
      })
    });
  });
  await page.route("**/api/public/qr/e2e-booking/event", async (route) => {
    await route.fulfill({
      status: 204,
      body: ""
    });
  });

  await page.goto("/book/e2e-booking");

  await expect(page.getByRole("heading", { name: "Pick a date, then choose an open time" })).toBeVisible();
  await page.getByRole("button", { name: "11:00 AM" }).click();
  await page.getByLabel("Full Name").fill("Jamie Homeowner");
  await page.getByLabel("Phone").fill("555-222-3333");
  await page.getByLabel(/Property Address/).fill("17 Summer St");
  await page.getByRole("button", { name: "Book Home Consult" }).click();

  await expect.poll(() => submittedBooking?.firstName).toBe("Jamie");
  await expect.poll(() => submittedBooking?.address).toBe("17 Summer St");
  await expect(page.getByText("You’re booked. The rep now has your lead and appointment in Lumino.")).toBeVisible();
});
