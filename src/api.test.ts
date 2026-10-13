import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("@neondatabase/auth", () => ({ createAuthClient: () => mock }));
import { api, token, json } from "./api";
beforeEach(() => {
  vi.restoreAllMocks();
  mock.token.mockResolvedValue({ data: { token: "signed-jwt" }, error: null });
});
it("accepts a fresh token response", async () =>
  expect(await token()).toBe("signed-jwt"));
it("accepts the Neon cached session JWT shape", async () => {
  mock.token.mockResolvedValue({
    data: { session: { token: "cached-jwt" } },
    error: null,
  });
  expect(await token()).toBe("cached-jwt");
});
it("rejects missing tokens and auth errors", async () => {
  mock.token.mockResolvedValue({ data: null, error: { message: "expired" } });
  await expect(token()).rejects.toThrow("Please sign in again");
});
it("adds bearer authorization and preserves JSON bodies", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response('{"ok":true}'));
  expect(await api("/me", json("PATCH", { name: "Alice" }))).toEqual({
    ok: true,
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/me",
    expect.objectContaining({
      body: '{"name":"Alice"}',
      headers: expect.objectContaining({ Authorization: "Bearer signed-jwt" }),
    }),
  );
});
it("lets the browser add multipart boundaries for uploads", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  await api("/photos", { method: "POST", body: new FormData() });
  expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty("Content-Type");
});
it("shows server error messages and supports empty logout responses", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response('{"error":"Access denied"}', { status: 403 }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(api("/private")).rejects.toThrow("Access denied");
  expect(await api("/logout", json("POST", {}))).toBeUndefined();
});
