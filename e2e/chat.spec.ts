import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
async function login(page: Page, user: string) {
  await page.goto("/");
  await page.getByLabel("Email address").fill(user + "@example.test");
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Messages." })).toBeVisible();
}
test("sign-up, profile update, session restoration and logout", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByLabel("Your name").fill("New Friend");
  await page
    .getByLabel("Email address")
    .fill(`friend-${Date.now()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("button", { name: "Profile and settings" }).click();
  await page.getByLabel("Handle", { exact: true }).fill("friend_" + Date.now());
  await page.getByLabel("A little about you").fill("I love coffee");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Messages." })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
});
test("two people exchange live messages and photos, history survives reload", async ({
  page,
  browser,
}, testInfo) => {
  const other = await browser.newContext(testInfo.project.use);
  const bob = await other.newPage();
  try {
    await login(page, "alice");
    await login(bob, "bob");
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
    await page.getByLabel("Find people").fill("Bob");
    await page
      .locator("label.person")
      .filter({ hasText: "Bob" })
      .getByRole("checkbox")
      .check();
    await page.getByRole("button", { name: "Start chatting" }).click();
    await expect(
      page.getByRole("heading", { name: "Bob", exact: true }),
    ).toBeVisible();
    await bob.getByRole("button").filter({ hasText: "Alice" }).first().click();
    const text = "Hello from " + testInfo.project.name + " " + Date.now();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(text);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      bob
        .getByLabel("Messages", { exact: true })
        .getByText(text, { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel("Messages", { exact: true })
        .getByText(text, { exact: true }),
    ).toBeVisible();
    const priorPhotos = await bob
      .getByRole("img", { name: "Shared photo" })
      .count();
    await page.getByLabel("Attach photo").setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 320, height: 200, channels: 3, background: "#6b8c65" },
      })
        .png()
        .toBuffer(),
    });
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(bob.getByRole("img", { name: "Shared photo" })).toHaveCount(
      priorPhotos + 1,
    );
    await expect(
      bob.getByRole("img", { name: "Shared photo" }).last(),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button").filter({ hasText: "Bob" }).first().click();
    await expect(
      page
        .getByLabel("Messages", { exact: true })
        .getByText(text, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Shared photo" })).toHaveCount(
      priorPhotos + 1,
    );
    await page.context().setOffline(true);
    const missed = "While you were away " + Date.now();
    await bob
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(missed);
    await bob
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.context().setOffline(false);
    await expect(
      page
        .getByLabel("Messages", { exact: true })
        .getByText(missed, { exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      await page.evaluate(() => innerWidth),
    );
    await page.screenshot({
      path: `test-results/chat-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});
test("group conversation and block controls", async ({ page }, testInfo) => {
  await login(page, "eve");
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page.getByLabel("Make it a group").check();
  await page.getByLabel("Group name").fill("Weekend " + testInfo.project.name);
  await page
    .locator("label.person")
    .filter({ hasText: "Alice" })
    .getByRole("checkbox")
    .check();
  await page
    .locator("label.person")
    .filter({ hasText: "Bob" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(
    page.getByRole("heading", { name: "Weekend " + testInfo.project.name }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conversation members" }).click();
  await page
    .locator(".privacy-person")
    .filter({ hasText: "Alice" })
    .getByRole("button", { name: "Block", exact: true })
    .click();
  await expect(
    page
      .locator(".privacy-person")
      .filter({ hasText: "Alice" })
      .getByRole("button", { name: "Unblock" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Conversation members" }).click();
  await page
    .locator(".privacy-person")
    .filter({ hasText: "Alice" })
    .getByRole("button", { name: "Unblock" })
    .click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeEnabled();
});
