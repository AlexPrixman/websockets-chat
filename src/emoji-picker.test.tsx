import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmojiPicker, insertEmoji } from "./emoji-picker";

afterEach(cleanup);

describe("emoji composer", () => {
  it("inserts at the caret or replaces selected text without splitting emoji", () => {
    expect(insertEmoji("Hello Bob", 6, 6, "✨")).toEqual({ text: "Hello ✨Bob", caret: 7 });
    expect(insertEmoji("Hi Bob", 3, 6, "🥳")).toEqual({ text: "Hi 🥳", caret: 5 });
    expect(insertEmoji("a".repeat(4000), 4000, 4000, "😀")).toBeNull();
  });

  it("filters named emoji, selects one, and closes with Escape", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn(() => true);
    render(<EmojiPicker disabled={false} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), "sparkles");
    expect(screen.getByRole("button", { name: "Add sparkles emoji" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add coffee emoji" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add sparkles emoji" }));
    expect(onSelect).toHaveBeenCalledWith("✨");
    expect(screen.queryByRole("searchbox", { name: "Search emoji" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Choose emoji" })).toHaveFocus();
    expect(screen.queryByRole("searchbox", { name: "Search emoji" })).not.toBeInTheDocument();
  });

  it("keeps the panel open if the message has reached its length limit", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker disabled={false} onSelect={() => false} />);
    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    await user.click(screen.getByRole("button", { name: "Add grinning face emoji" }));
    expect(screen.getByRole("searchbox", { name: "Search emoji" })).toBeVisible();
  });
});
