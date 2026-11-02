import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
const palettes = [...css.matchAll(/:root(?:\[data-theme="dark"\])? \{([^}]+)/g)]
  .map((match) => Object.fromEntries([...match[1].matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)]
    .map((color) => [color[1], color[2]])));
function luminance(hex) {
  const rgb = hex.slice(1).match(/\w\w/g).map((value) => parseInt(value, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
for (const index of [0, 1]) {
  test(`${index === 0 ? "light" : "dark"} semantic text pairs meet WCAG AA normal-text contrast`, () => {
    assert.equal(palettes.length, 2);
    const colors = { ...palettes[0], ...palettes[index] };
    for (const [text, background] of [
      ["ink", "surface"], ["ink", "canvas"], ["muted", "soft"],
      ["muted", "surface"], ["muted", "canvas"], ["muted-strong", "sent"],
      ["sent-ink", "sent"], ["accent-ink", "accent-soft"], ["accent-ink", "hero"],
      ["on-accent", "accent"], ["danger", "danger-soft"],
      ["lilac-ink", "lilac"], ["coral-ink", "coral"], ["sky-ink", "sky"],
    ]) {
      const a = luminance(colors[text]), b = luminance(colors[background]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, `${text} on ${background}: contrast ${ratio.toFixed(2)}`);
    }
  });
}
