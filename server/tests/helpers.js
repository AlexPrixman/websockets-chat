import { randomUUID } from "node:crypto";
import { database } from "../db.js";
import { createApp } from "../app.js";
import { PGlite } from "@electric-sql/pglite";
import { AsyncLocalStorage } from "node:async_hooks";
import { schema as ddl } from "../schema.js";
export const databaseUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres@127.0.0.1:55432/postgres";
export const config = {
  production: false,
  publicUrl: "http://localhost:4173",
  authUrl: "",
  moderatorId: "moderator",
};
export async function testDatabase() {
  if (!process.env.USE_PGLITE)
    return database(databaseUrl, {
      temporarySchema: "circlechat_test_" + randomUUID().replaceAll("-", ""),
    });
  const db = new PGlite();
  await db.exec(ddl);
  const context = new AsyncLocalStorage();
  const query = (sql, args = []) => (context.getStore() || db).query(sql, args);
  return {
    query,
    one: async (s, a) => (await query(s, a)).rows[0],
    all: async (s, a) => (await query(s, a)).rows,
    transaction: (job) =>
      context.getStore() ? job() : db.transaction((tx) => context.run(tx, job)),
    close: () => db.close(),
  };
}
export async function fixture() {
  const db = await testDatabase();
  const objects = new Map();
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokens = new Map(
    ["alice", "bob", "eve", "moderator"].map((user) => [
      user,
      { sub: user, name: user, iat: issuedAt, exp: issuedAt + 3600 },
    ]),
  );
  const runtime = createApp(db, config, {
    verifyToken: async (token) => {
      if (!tokens.has(token)) throw new Error("Invalid");
      return tokens.get(token);
    },
    files: {
      put: async (k, b) => objects.set(k, b),
      get: async (k) => objects.get(k),
    },
  });
  return {
    ...runtime,
    db,
    objects,
    tokens,
    dispose: async () => {
      await runtime.close();
      await db.close();
    },
  };
}
