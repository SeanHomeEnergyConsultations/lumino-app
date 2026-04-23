import { expect, test } from "@playwright/test";
import { buildAuthState, seedAuth, stubTelemetry } from "./support/auth";
import { buildTeamMember } from "./support/fixtures";

test.beforeEach(async ({ page }) => {
  await stubTelemetry(page);
  await seedAuth(page, buildAuthState({ role: "owner" }));
});

test("invites a teammate from the Team workspace", async ({ page }) => {
  let members = [buildTeamMember()];
  let invitePayload: Record<string, unknown> | null = null;

  await page.route("**/api/dashboard/manager", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "skip dashboard" })
    });
  });
  await page.route("**/api/territories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });
  await page.route("**/api/team/teams", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });
  await page.route("**/api/team/members", async (route) => {
    if (route.request().method() === "POST") {
      invitePayload = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      members = [
        ...members,
        buildTeamMember({
          memberId: "member_2",
          userId: "member_user_2",
          fullName: invitePayload.fullName,
          email: invitePayload.email,
          role: invitePayload.role,
          onboardingStatus: "pending"
        })
      ];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: members,
        issues: []
      })
    });
  });

  await page.goto("/team");

  await page.getByPlaceholder("Full name").fill("Morgan Setter");
  await page.getByPlaceholder("Email").fill("morgan@lumino.test");
  await page.getByRole("button", { name: "Invite User" }).click();

  await expect.poll(() => invitePayload?.email).toBe("morgan@lumino.test");
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator("div:visible").filter({ hasText: "Morgan Setter" }).first()).toBeVisible();
});
