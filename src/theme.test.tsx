import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeTheme, readThemePreference, ThemeProvider, ThemeSettings, ThemeSwitch } from "./theme";

let darkDevice = false;
const listeners = new Set<() => void>();
const media = {
  get matches() { return darkDevice; },
  addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
  removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
};
function deviceChangesTo(dark: boolean) {
  act(() => { darkDevice = dark; for (const listener of listeners) listener(); });
}
function controls() {
  return render(<ThemeProvider><ThemeSwitch /><ThemeSettings /></ThemeProvider>);
}
beforeEach(() => {
  localStorage.clear();
  darkDevice = false;
  listeners.clear();
  delete document.documentElement.dataset.theme;
  vi.stubGlobal("matchMedia", vi.fn(() => media));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("CircleChat appearance", () => {
  it("follows the device by default and initializes before React mounts", () => {
    darkDevice = true;
    expect(readThemePreference()).toBe("system");
    expect(initializeTheme()).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    controls();
    expect(screen.getByRole("button", { name: /Device/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  });

  it("updates immediately with system theme changes", () => {
    controls();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    deviceChangesTo(true);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    deviceChangesTo(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("circlechat-theme")).toBeNull();
  });

  it("persists a manual override and ignores device changes until Device is selected", async () => {
    const user = userEvent.setup();
    controls();
    await user.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(localStorage.getItem("circlechat-theme")).toBe("dark");
    deviceChangesTo(false);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(screen.getByRole("button", { name: /Device/ }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("circlechat-theme")).toBe("system");
    deviceChangesTo(true);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("quick switch is keyboard accessible and a saved choice survives remount", async () => {
    const user = userEvent.setup();
    const first = controls();
    await user.tab();
    expect(screen.getByRole("button", { name: "Switch to dark mode" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("circlechat-theme")).toBe("dark");
    first.unmount();
    darkDevice = false;
    controls();
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("light override is respected even on a dark device", () => {
    localStorage.setItem("circlechat-theme", "light");
    darkDevice = true;
    initializeTheme();
    controls();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("button", { name: "Light theme" })).toHaveAttribute("aria-pressed", "true");
  });

  it("syncs choices from other tabs and resets to system when storage is cleared", () => {
    controls();
    localStorage.setItem("circlechat-theme", "dark");
    fireEvent(window, new StorageEvent("storage", { key: "circlechat-theme", newValue: "dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    localStorage.clear();
    fireEvent(window, new StorageEvent("storage", { key: null }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("button", { name: /Device/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("rejects corrupt saved preferences and works when storage is unavailable", async () => {
    localStorage.setItem("circlechat-theme", "unexpected");
    expect(readThemePreference()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    controls();
    await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("removes the device listener when unmounted or manually overridden", async () => {
    const view = controls();
    expect(listeners.size).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Dark theme" }));
    expect(listeners.size).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: /Device/ }));
    expect(listeners.size).toBe(1);
    view.unmount();
    expect(listeners.size).toBe(0);
  });

  it("has a safe light fallback when the browser lacks system preference support", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(initializeTheme()).toBe("light");
    controls();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
