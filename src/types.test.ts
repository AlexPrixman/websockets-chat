import { describe, it, expect } from "vitest";
import {
  mergeMessages,
  titleOf,
  type Message,
  type Conversation,
} from "./types";
const m = (id: string, text = "test") => ({ id, text }) as Message;
describe("message reconciliation", () => {
  it("deduplicates retries and applies deletion events", () =>
    expect(mergeMessages([m("2")], [m("2", "removed")])).toEqual([
      m("2", "removed"),
    ]));
  it("sorts IDs without losing bigint precision", () =>
    expect(
      mergeMessages([m("9007199254740993")], [m("9007199254740992")]).map(
        (x) => x.id,
      ),
    ).toEqual(["9007199254740992", "9007199254740993"]));
  it("retains live messages when older history arrives", () =>
    expect(mergeMessages([m("40")], [m("1"), m("2")]).map((x) => x.id)).toEqual(
      ["1", "2", "40"],
    ));
  it("uses the other participant for a direct conversation title", () =>
    expect(
      titleOf(
        {
          kind: "direct",
          members: [
            { id: "a", name: "Alice" },
            { id: "b", name: "Bob" },
          ],
        } as Conversation,
        "a",
      ),
    ).toBe("Bob"));
  it("uses the named group title", () =>
    expect(
      titleOf({ kind: "group", title: "Friends" } as Conversation, "a"),
    ).toBe("Friends"));
});
