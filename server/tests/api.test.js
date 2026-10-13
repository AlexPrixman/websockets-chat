import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { io } from "socket.io-client";
import { fixture } from "./helpers.js";
let f, api, id, messageId, photoId;
const as = (method, path, user = "alice") =>
  api[method]("/api" + path).set("Authorization", "Bearer " + user);
before(async () => {
  f = await fixture();
  api = request(f.app);
  for (const u of ["alice", "bob", "eve", "moderator"])
    await as("get", "/me", u).expect(200);
});
after(async () => f?.dispose());
test("requires authentication and rejects cross-site mutation", async () => {
  await api.get("/api/me").expect(401);
  await as("get", "/me", "forged").expect(401);
  await as("patch", "/me")
    .set("Origin", "https://evil.example")
    .send({})
    .expect(403);
});
test("profile validation and case-insensitive unique handles", async () => {
  await as("patch", "/me")
    .send({ name: "Alice", handle: "alice", bio: "Hello" })
    .expect(200);
  await as("patch", "/me", "bob")
    .send({ name: "Bob", handle: "ALICE", bio: "" })
    .expect(409);
  await as("patch", "/me", "bob")
    .send({ name: "Bob", handle: "bob", bio: "" })
    .expect(200);
  await as("patch", "/me")
    .send({ name: "Alice", handle: "../bad" })
    .expect(400);
});
test("direct conversations are idempotent under concurrent requests", async () => {
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      as("post", "/conversations")
        .send({ kind: "direct", memberIds: ["bob"] })
        .expect(201),
    ),
  );
  id = results[0].body.id;
  assert.ok(results.every((r) => r.body.id === id));
  assert.equal((await as("get", "/conversations", "eve")).body.length, 0);
});
test("nonmembers cannot read, send, query presence or forge read receipts", async () => {
  for (const suffix of ["messages", "receipts", "presence"])
    await as("get", `/conversations/${id}/${suffix}`, "eve").expect(404);
  await as("post", `/conversations/${id}/messages`, "eve")
    .send({ clientId: randomUUID(), text: "intrusion" })
    .expect(404);
  await as("post", `/conversations/${id}/read`, "eve")
    .send({ lastReadId: "1" })
    .expect(404);
});
test("messages persist and retries do not duplicate", async () => {
  const payload = { clientId: randomUUID(), text: "Hello Bob!" };
  const first = await as("post", `/conversations/${id}/messages`)
    .send(payload)
    .expect(201);
  messageId = first.body.id;
  const retry = await as("post", `/conversations/${id}/messages`)
    .send(payload)
    .expect(201);
  assert.equal(retry.body.id, messageId);
  const history = await as(
    "get",
    `/conversations/${id}/messages`,
    "bob",
  ).expect(200);
  assert.equal(history.body.items.length, 1);
  assert.equal(history.body.items[0].text, payload.text);
  const list = await as("get", "/conversations", "bob");
  assert.equal(list.body[0].unread, 1);
});
test("read receipts advance monotonically and require conversation message", async () => {
  await as("post", `/conversations/${id}/read`, "bob")
    .send({ lastReadId: messageId })
    .expect(200);
  await as("post", `/conversations/${id}/read`, "bob")
    .send({ lastReadId: "999999" })
    .expect(400);
  assert.equal((await as("get", "/conversations", "bob")).body[0].unread, 0);
});
test("photo normalization, access control and ownership", async () => {
  const bytes = await sharp({
    create: { width: 20, height: 12, channels: 3, background: "#6c8f66" },
  })
    .png()
    .toBuffer();
  await as("post", `/conversations/${id}/photos`, "eve")
    .attach("photo", bytes, "pic.png")
    .expect(404);
  await as("post", `/conversations/${id}/photos`)
    .attach("photo", Buffer.from("<svg/>"), "bad.png")
    .expect(400);
  const p = await as("post", `/conversations/${id}/photos`)
    .attach("photo", bytes, "pic.png")
    .expect(201);
  photoId = p.body.id;
  await as("get", "/photos/" + photoId).expect(404);
  await as("post", `/conversations/${id}/messages`, "bob")
    .send({ clientId: randomUUID(), photoId })
    .expect(400);
  await as("post", `/conversations/${id}/messages`)
    .send({ clientId: randomUUID(), photoId, text: "Photo" })
    .expect(201);
  await as("get", "/photos/" + photoId, "bob")
    .expect(200)
    .expect("Content-Type", /image\/jpeg/);
  await as("get", "/photos/" + photoId, "eve").expect(404);
});
test("only message owner may remove it and deleted photos become inaccessible", async () => {
  await as("delete", "/messages/" + messageId, "bob").expect(403);
  await as("delete", "/messages/" + messageId).expect(200);
  const history = (await as("get", `/conversations/${id}/messages`)).body.items;
  assert.equal(history[0].text, "");
  assert.ok(history[0].deletedAt);
  const photoMessage = history.find((m) => m.photo);
  await as("delete", "/messages/" + photoMessage.id).expect(200);
  await as("get", "/photos/" + photoId, "bob").expect(404);
});
test("blocking prevents messages and discovery; unblocking restores ability", async () => {
  await as("put", "/blocks/bob").expect(200);
  await as("post", `/conversations/${id}/messages`, "bob")
    .send({ clientId: randomUUID(), text: "Blocked" })
    .expect(403);
  assert.equal((await as("get", "/people?q=alice", "bob")).body.length, 0);
  assert.equal(
    (await as("get", `/conversations/${id}/presence`, "bob")).body.length,
    0,
  );
  await as("delete", "/blocks/bob").expect(200);
  await as("post", `/conversations/${id}/messages`, "bob")
    .send({ clientId: randomUUID(), text: "Unblocked" })
    .expect(201);
});
test("reports require membership and only moderators review them", async () => {
  await as("post", "/reports", "eve")
    .send({ messageId, reason: "spam" })
    .expect(404);
  await as("post", "/reports", "bob")
    .send({ messageId, reason: "spam" })
    .expect(201);
  await as("get", "/reports").expect(403);
  const r = await as("get", "/reports", "moderator").expect(200);
  await as("patch", "/reports/" + r.body[0].id, "moderator")
    .send({ status: "reviewed" })
    .expect(200);
});
test("group creation and cursor pagination keep message order", async () => {
  const group = await as("post", "/conversations")
    .send({ kind: "group", title: "Friends", memberIds: ["bob", "eve"] })
    .expect(201);
  for (let n = 0; n < 45; n++)
    await f.chat.send(group.body.id, "alice", {
      clientId: randomUUID(),
      text: `message ${n}`,
    });
  const page = (
    await as("get", `/conversations/${group.body.id}/messages`, "eve")
  ).body;
  assert.equal(page.items.length, 40);
  assert.equal(page.hasMore, true);
  const previous = (
    await as(
      "get",
      `/conversations/${group.body.id}/messages?before=${page.nextCursor}`,
      "eve",
    )
  ).body;
  assert.equal(previous.items.length, 5);
  assert.equal(previous.hasMore, false);
  assert.ok(BigInt(previous.items.at(-1).id) < BigInt(page.items[0].id));
});
test("real-time delivery, typing, nonmember isolation and logout revocation", async () => {
  await new Promise((resolve) => f.server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + f.server.address().port;
  const sockets = ["alice", "bob", "eve"].map((token) =>
    io(url, { auth: { token }, transports: ["websocket"], autoConnect: false }),
  );
  try {
    await Promise.all(
      sockets.map(
        (s) =>
          new Promise((resolve, reject) => {
            s.once("connect", resolve);
            s.once("connect_error", reject);
            s.connect();
          }),
      ),
    );
    const [a, b, e] = sockets;
    let leaked = false;
    e.on("message:new", () => {
      leaked = true;
    });
    const received = new Promise((resolve) => b.once("message:new", resolve));
    const response = await a
      .timeout(3000)
      .emitWithAck("message:send", {
        conversationId: id,
        clientId: randomUUID(),
        text: "Realtime",
      });
    assert.equal(response.ok, true);
    assert.equal((await received).text, "Realtime");
    const typing = new Promise((resolve) => b.once("typing", resolve));
    a.emit("typing", { conversationId: id, active: true });
    assert.equal((await typing).active, true);
    const denied = await e
      .timeout(3000)
      .emitWithAck("message:send", {
        conversationId: id,
        clientId: randomUUID(),
        text: "bad",
      });
    assert.equal(denied.status, 404);
    assert.equal(leaked, false);
    const disconnected = new Promise((resolve) =>
      a.once("disconnect", resolve),
    );
    await as("post", "/logout").send({}).expect(204);
    await disconnected;
    await as("get", "/me").expect(401);
  } finally {
    sockets.forEach((s) => s.disconnect());
  }
});
