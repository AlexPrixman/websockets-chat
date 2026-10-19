import { describe, expect, it } from "vitest";
import { expiryLabel, statusGroups } from "./statuses";
import type { StatusUpdate } from "./types";

function status(
  id: string,
  owner: string,
  {
    viewed = false,
    tagged = false,
    createdAt = "2026-01-01T00:00:00.000Z",
  } = {},
): StatusUpdate {
  return {
    id,
    owner: { id: owner, name: owner, handle: owner },
    text: id,
    background: "sage",
    overlays: [],
    mentions: [],
    tagged,
    viewedAt: viewed ? createdAt : null,
    createdAt,
    expiresAt: "2026-01-02T00:00:00.000Z",
    media: null,
  };
}

describe("status presentation", () => {
  it("groups updates by owner and prioritizes self, tags, then unseen contacts", () => {
    const groups = statusGroups(
      [
        status("seen", "dana", { viewed: true }),
        status("unseen", "bob"),
        status("mine", "alice"),
        status("tagged", "eve", { tagged: true }),
        status("bob-second", "bob", { viewed: true }),
      ],
      "alice",
    );
    expect(groups.map((group) => group[0].owner.id)).toEqual([
      "alice",
      "eve",
      "bob",
      "dana",
    ]);
    expect(groups.find((group) => group[0].owner.id === "bob")).toHaveLength(2);
  });

  it("communicates remaining status time without showing a negative value", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    expect(expiryLabel("2026-01-01T02:00:00.000Z", now)).toBe("Expires in 2h");
    expect(expiryLabel("2026-01-01T00:12:00.000Z", now)).toBe("Expires in 12m");
    expect(expiryLabel("2025-12-31T23:00:00.000Z", now)).toBe(
      "Expires in under a minute",
    );
  });
});
