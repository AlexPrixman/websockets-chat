import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { authProxy } from "../auth-proxy.js";
function app(fetcher) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    authProxy(
      {
        authUrl: "https://auth.example.test/app/auth",
        publicUrl: "https://chat.example.test",
      },
      fetcher,
    ),
  );
  return request(app);
}
test("auth proxy forwards only to configured provider and preserves JWT response", async () => {
  let call;
  const api = app(async (url, options) => {
    call = { url, options };
    return new Response('{"user":{"id":"alice"}}', {
      headers: {
        "set-auth-jwt": "signed-token",
        "set-cookie":
          "__Secure-session=value; Domain=auth.example.test; Path=/app/auth; Secure; HttpOnly; SameSite=Lax",
      },
    });
  });
  const r = await api
    .post("/api/auth/sign-in/email")
    .set("Cookie", "__Secure-session=old")
    .send({ email: "a@example.test", password: "test-password" })
    .expect(200);
  assert.equal(call.url, "https://auth.example.test/app/auth/sign-in/email");
  assert.equal(call.options.headers.Origin, "https://chat.example.test");
  assert.equal(call.options.headers.Cookie, "__Secure-session=old");
  assert.equal(r.headers["set-auth-jwt"], "signed-token");
  assert.match(r.headers["set-cookie"][0], /Path=\//);
  assert.doesNotMatch(r.headers["set-cookie"][0], /Domain=/);
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
});
test("auth proxy does not expose unneeded upstream routes", async () => {
  let fetched = false;
  const api = app(async () => {
    fetched = true;
    return new Response("{}");
  });
  await api.post("/api/auth/admin/create-user").send({}).expect(404);
  assert.equal(fetched, false);
});
test("auth proxy contains upstream failures and redirects", async () => {
  await app(async () => {
    throw new Error("private upstream details");
  })
    .get("/api/auth/token")
    .expect(502)
    .expect((r) => assert.doesNotMatch(r.text, /private/));
  await app(
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.test" },
      }),
  )
    .get("/api/auth/get-session")
    .expect(502);
});
