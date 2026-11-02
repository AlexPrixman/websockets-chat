import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(`appearance-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Messages." })).toBeVisible();
}
async function startChat(page: Page) {
  await page.getByRole("button", { name: "New conversation", exact: true }).click();
  await page.getByLabel("Find people").fill("Bob");
  await page.locator("label.person").filter({ hasText: "Bob" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Start chatting" }).click();
  await expect(page.getByRole("heading", { name: "Bob", exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => innerWidth));
}

test("system appearance is the default and quick switch persists before sign-in", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `test-results/signin-dark-${info.project.name}.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: `test-results/signin-light-${info.project.name}.png`, fullPage: true });
  await noOverflow(page);
});

test("appearance choices style chats, emoji and status dialogs and restore device following", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  await register(page, `Appearance ${info.project.name}`);
  await page.getByRole("button", { name: "Profile and settings" }).click();
  await expect(page.getByRole("button", { name: "Device theme (default)" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: `test-results/appearance-settings-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await startChat(page);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("A fresh look, same circle. ✨");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".mine .bubble").getByText("A fresh look, same circle. ✨", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/redesign-dark-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Choose emoji" }).click();
  await expect(page.getByRole("searchbox", { name: "Search emoji" })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Close emoji picker" }).click();
  await page.getByRole("button", { name: "Conversation members" }).click();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({ path: `test-results/redesign-light-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Conversation members" }).click();
  await page.getByRole("button", { name: "Device theme (default)" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  if (info.project.name === "mobile") await page.getByRole("button", { name: "Back to conversations" }).click();
  await page.getByRole("button", { name: "Add status" }).last().click();
  await page.getByRole("textbox", { name: "Status text" }).fill("A little moment 🌴");
  await expect(page.locator(".status-main-text")).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({ path: `test-results/status-dark-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Close status composer" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await noOverflow(page);
});

test("conversation controls stay reachable across narrow, tablet and wide layouts in both themes", async ({ page }, info) => {
  await register(page, `Responsive ${info.project.name}`);
  await startChat(page);
  for (const width of [320, 390, 620, 621, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await noOverflow(page);
      for (const name of ["Start voice call", "Conversation members", "Delete conversation for me", "Choose emoji", "Record voice note"]) {
        const control = page.getByRole("button", { name, exact: true });
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      const textbox = await page.getByRole("textbox", { name: "Message", exact: true }).boundingBox();
      expect(textbox!.width).toBeGreaterThan(40);
    }
  }
});
