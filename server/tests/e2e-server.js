// Isolated test server. Never imported by the production entry point.
import express from "express";
import { randomUUID } from "node:crypto";
import { createApp } from "../app.js";
import { testDatabase } from "./helpers.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Test server is prohibited in production");
const db = await testDatabase();
const sessions = new Map(),
  users = new Map(),
  photos = new Map();
for (const [id, name] of [
  ["alice", "Alice"],
  ["bob", "Bob"],
  ["eve", "Eve"],
])
  users.set(id + "@example.test", {
    id,
    name,
    email: id + "@example.test",
    password: "TestPassword123!",
  });
const router = express.Router();
const session = (req) =>
  sessions.get(req.headers.cookie?.match(/circle_test=([^;]+)/)?.[1]);
const data = (u) =>
  u
    ? {
        user: { id: u.id, name: u.name, email: u.email },
        session: {
          id: u.id,
          token: u.id,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }
    : null;
router.get("/get-session", (req, res) => res.json(data(session(req))));
router.post("/sign-in/email", (req, res) => {
  const u = users.get(req.body.email);
  if (!u || u.password !== req.body.password)
    return res.status(401).json({ message: "Invalid email or password" });
  const key = randomUUID();
  sessions.set(key, u);
  res
    .cookie("circle_test", key, { httpOnly: true, sameSite: "lax" })
    .json({ ...data(u), token: key });
});
router.post("/sign-up/email", (req, res) => {
  if (users.has(req.body.email))
    return res.status(400).json({ message: "Email already exists" });
  const u = { id: randomUUID(), ...req.body };
  users.set(u.email, u);
  const key = randomUUID();
  sessions.set(key, u);
  res
    .cookie("circle_test", key, { httpOnly: true, sameSite: "lax" })
    .json({ ...data(u), token: key });
});
router.get("/token", (req, res) => {
  const u = session(req);
  if (!u) return res.status(401).json({ message: "Unauthorized" });
  res.json({ token: u.id });
});
router.post("/sign-out", (req, res) => {
  sessions.delete(req.headers.cookie?.match(/circle_test=([^;]+)/)?.[1]);
  res.clearCookie("circle_test").json({ success: true });
});
const runtime = createApp(
  db,
  {
    production: false,
    publicUrl: "http://localhost:4173",
    authUrl: "",
    moderatorId: "",
  },
  {
    authTestRouter: router,
    verifyToken: async (token) => {
      const u = [...users.values()].find((u) => u.id === token);
      if (!u) throw new Error("Invalid token");
      return {
        sub: u.id,
        name: u.name,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    },
    files: {
      put: async (k, b) => photos.set(k, b),
      get: async (k) => photos.get(k),
    },
  },
);
for (const u of users.values()) await runtime.auth.actor(u.id);
runtime.server.listen(4173, "127.0.0.1", () =>
  console.log("Test server ready"),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await runtime.close();
    await db.close();
    process.exit(0);
  });
