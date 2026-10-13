import { test } from "node:test";
import assert from "node:assert/strict";
import { text, handle, cursor, uuid } from "../validation.js";
import { configuration } from "../config.js";
test("text validates types and trims without accepting empty required fields", () => {
  assert.equal(text(" Hi ", "Name", 5), "Hi");
  for (const x of [null, [], {}, "  ", "longer"])
    assert.throws(() => text(x, "Name", 5));
});
test("handles are normalized and constrained", () => {
  assert.equal(handle("Alice_1"), "alice_1");
  for (const x of ["1alice", "a", "hello world"])
    assert.throws(() => handle(x));
});
test("cursor keeps large integers exact and rejects SQL payloads", () => {
  assert.equal(cursor("9007199254740993"), "9007199254740993");
  for (const x of ["0", "1 OR 1=1", "-1", 1]) assert.throws(() => cursor(x));
});
test("record identifiers must be valid UUIDs", () => {
  assert.throws(() => uuid("invalid"));
  assert.equal(
    uuid("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000",
  );
});
test("production rejects incomplete config and insecure origin", () => {
  assert.throws(() => configuration({ NODE_ENV: "production" }));
  assert.throws(() =>
    configuration({ PUBLIC_APP_URL: "https://example.com/path" }),
  );
});
