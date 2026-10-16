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
  const user = `friend-${Date.now()}`;
  await page.getByLabel("Email address").fill(`${user}@example.test`);
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
  const { token: earlierToken } = await (
    await page.request.get("/api/auth/token")
  ).json();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Messages." })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back." }),
  ).toBeVisible();
  const revoked = await page.request.get("/api/me", {
    headers: { Authorization: "Bearer " + earlierToken },
  });
  expect(revoked.status()).toBe(401);
  await login(page, user);
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
    await expect(page.getByRole("img", { name: "Shared photo" }).last()).toBeVisible();
    const ownPhotos = await page.getByRole("img", { name: "Shared photo" }).count();
    await page.reload();
    await page.getByRole("button").filter({ hasText: "Bob" }).first().click();
    await expect(
      page
        .getByLabel("Messages", { exact: true })
        .getByText(text, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Shared photo" })).toHaveCount(
      ownPhotos,
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
test("emoji picker inserts at the cursor and delivers saved messages", async ({ page, browser }, testInfo) => {
  const other = await browser.newContext(testInfo.project.use);
  const bob = await other.newPage();
  const senderName = `Emoji sender ${testInfo.project.name}`;
  const recipientName = `Emoji recipient ${testInfo.project.name}`;
  // Independent identities keep repeated browser flows from sharing account limits.
  async function register(target: Page, name: string) {
    await target.goto("/");
    await target.getByRole("button", { name: "New here? Create an account" }).click();
    await target.getByLabel("Your name").fill(name);
    await target.getByLabel("Email address").fill(`${name.replaceAll(" ", "-")}-${Date.now()}@example.test`);
    await target.getByLabel("Password", { exact: true }).fill("TestPassword123!");
    await target.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(target.getByRole("heading", { name: "Messages." })).toBeVisible();
  }
  try {
    await register(page, senderName);
    await register(bob, recipientName);
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Find people").fill(recipientName);
    await page.locator("label.person").filter({ hasText: recipientName }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start chatting" }).click();
    await bob.getByRole("button").filter({ hasText: senderName }).first().click();
    const field = page.getByRole("textbox", { name: "Message", exact: true });
    await field.fill("Hello Bob");
    await field.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
    await page.getByRole("button", { name: "Choose emoji" }).click();
    await page.screenshot({ path: `test-results/emoji-picker-${testInfo.project.name}.png`, fullPage: true });
    await page.getByRole("searchbox", { name: "Search emoji" }).fill("sparkles");
    await page.getByRole("button", { name: "Add sparkles emoji" }).click();
    const message = "Hello ✨Bob";
    await expect(field).toHaveValue(message);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(bob.getByLabel("Messages", { exact: true }).getByText(message, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button").filter({ hasText: recipientName }).first().click();
    await expect(page.getByLabel("Messages", { exact: true }).getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.evaluate(() => innerWidth));
  } finally { await other.close(); }
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

test("voice note playback and delete for me preserve the other member's history", async ({ page, browser }, testInfo) => {
  const other = await browser.newContext(testInfo.project.use);
  const bob = await other.newPage();
  try {
    await login(page, "alice");
    await login(bob, "bob");
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Find people").fill("Bob");
    await page.locator("label.person").filter({ hasText: "Bob" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start chatting" }).click();
    await bob.getByRole("button").filter({ hasText: "Alice" }).first().click();
    const old = `Keep for Bob ${Date.now()}`;
    await page.getByRole("textbox", { name: "Message" }).fill(old);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(bob.getByLabel("Messages", { exact: true }).getByText(old)).toBeVisible();
    await page.getByRole("button", { name: "Record voice note" }).click();
    await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Recording 1s" })).toBeVisible();
    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect(page.getByRole("button", { name: "Remove voice note" })).toBeVisible();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(bob.locator('audio[aria-label="Voice note"]')).toBeVisible();
    const source = await bob.locator('audio[aria-label="Voice note"]').getAttribute("src");
    expect(source).toMatch(/^blob:/);
    const playable = await bob.locator('audio[aria-label="Voice note"]').evaluate(async (audio: HTMLAudioElement) => {
      await new Promise((resolve, reject) => {
        if (audio.readyState >= 1) return resolve(null);
        audio.addEventListener("loadedmetadata", resolve, { once: true });
        audio.addEventListener("error", reject, { once: true });
        audio.load();
      });
      return audio.duration > 0;
    });
    expect(playable).toBe(true);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete conversation for me" }).click();
    await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeHidden();
    await expect(page.getByRole("button").filter({ hasText: "Bob" })).toHaveCount(0);
    await expect(bob.getByLabel("Messages", { exact: true }).getByText(old)).toBeVisible();
    const next = `New after deletion ${Date.now()}`;
    await bob.getByRole("textbox", { name: "Message" }).fill(next);
    await bob.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("button").filter({ hasText: "Bob" }).first()).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Bob" }).first().click();
    await expect(page.getByLabel("Messages", { exact: true }).getByText(next)).toBeVisible();
    await expect(page.getByLabel("Messages", { exact: true }).getByText(old)).toHaveCount(0);
    await expect(page.locator('audio[aria-label="Voice note"]')).toHaveCount(0);
    await page.reload();
    await page.getByRole("button").filter({ hasText: "Bob" }).first().click();
    await expect(page.getByLabel("Messages", { exact: true }).getByText(old)).toHaveCount(0);
  } finally { await other.close(); }
});

test("three members connect group audio, mute and leave", async ({ page, browser }, testInfo) => {
  test.setTimeout(90000);
  const bobContext = await browser.newContext(testInfo.project.use);
  const eveContext = await browser.newContext(testInfo.project.use);
  const bob = await bobContext.newPage();
  const eve = await eveContext.newPage();
  try {
    await login(page, "alice");
    await login(bob, "bob");
    await login(eve, "eve");
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Make it a group").check();
    const title = `Audio ${testInfo.project.name} ${Date.now()}`;
    await page.getByLabel("Group name").fill(title);
    for (const name of ["Bob", "Eve"])
      await page.locator("label.person").filter({ hasText: name }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start chatting" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Start voice call" }).click();
    await expect(page.getByRole("region", { name: "Voice call" })).toContainText("Ringing your people");
    await expect(bob.getByRole("region", { name: "Voice call" })).toContainText("Incoming voice call");
    await expect(eve.getByRole("region", { name: "Voice call" })).toContainText("Incoming voice call");
    await bob.getByRole("button", { name: "Join call" }).click();
    await expect(page.getByRole("region", { name: "Voice call" })).toContainText("2 in call");
    await eve.getByRole("button", { name: "Join call" }).click();
    await expect(page.getByRole("region", { name: "Voice call" })).toContainText("3 in call");
    await expect(page.locator(".remote-audio audio")).toHaveCount(2);
    await expect(bob.locator(".remote-audio audio")).toHaveCount(2);
    await expect(eve.locator(".remote-audio audio")).toHaveCount(2);
    const remoteTracks = await page.locator(".remote-audio audio").evaluateAll((elements) =>
      elements.every((el) => (el as HTMLAudioElement).srcObject instanceof MediaStream &&
        ((el as HTMLAudioElement).srcObject as MediaStream).getAudioTracks().some((track) => track.readyState === "live")),
    );
    expect(remoteTracks).toBe(true);
    await bob.getByRole("button", { name: "Mute", exact: true }).click();
    await expect(bob.getByRole("button", { name: "Unmute" })).toBeVisible();
    await eve.getByRole("button", { name: "Leave call" }).click();
    await expect(page.locator(".remote-audio audio")).toHaveCount(1);
    await page.getByRole("button", { name: "Leave call" }).click();
    await expect(bob.getByRole("region", { name: "Voice call" })).toContainText("1 in call");
    await bob.getByRole("button", { name: "Leave call" }).click();
    await expect(bob.getByRole("region", { name: "Voice call" })).toHaveCount(0);
  } finally { await bobContext.close(); await eveContext.close(); }
});

test("a direct voice call connects and ends for both people", async ({ page, browser }, testInfo) => {
  const other = await browser.newContext(testInfo.project.use);
  const bob = await other.newPage();
  try {
    await login(page, "alice");
    await login(bob, "bob");
    await page.getByRole("button", { name: "New conversation" }).click();
    await page.getByLabel("Find people").fill("Bob");
    await page.locator("label.person").filter({ hasText: "Bob" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start chatting" }).click();
    await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start voice call" }).click();
    await expect(bob.getByRole("region", { name: "Voice call" })).toContainText("Incoming voice call");
    await bob.getByRole("button", { name: "Join call" }).click();
    await expect(page.locator(".remote-audio audio")).toHaveCount(1);
    await expect(bob.locator(".remote-audio audio")).toHaveCount(1);
    await page.getByRole("button", { name: "Leave call" }).click();
    await expect(bob.getByRole("region", { name: "Voice call" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Voice call" })).toHaveCount(0);
  } finally { await other.close(); }
});
