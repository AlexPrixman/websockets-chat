import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { schema } from "./schema.js";
export async function database(url, { temporarySchema = "" } = {}) {
  if (!url) throw new Error("Set DATABASE_URL to a PostgreSQL database");
  if (temporarySchema && !/^circlechat_test_[a-f0-9_]+$/.test(temporarySchema))
    throw new Error("Invalid test schema");
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
    ...(temporarySchema
      ? { options: `-c search_path=${temporarySchema}` }
      : {}),
  });
  pool.on("error", (e) =>
    console.error("Database connection error", e.code || e.name),
  );
  const context = new AsyncLocalStorage();
  const query = (sql, args = []) =>
    (context.getStore() || pool).query(sql, args);
  async function transaction(job) {
    if (context.getStore()) return job();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(827451)");
      const result = await context.run(c, job);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  try {
    if (temporarySchema) await pool.query(`CREATE SCHEMA "${temporarySchema}"`);
    await transaction(() => query(schema));
  } catch (e) {
    await pool.end();
    throw e;
  }
  return {
    query,
    transaction,
    one: async (sql, args = []) => (await query(sql, args)).rows[0],
    all: async (sql, args = []) => (await query(sql, args)).rows,
    close: async () => {
      if (temporarySchema)
        await pool.query(`DROP SCHEMA "${temporarySchema}" CASCADE`);
      await pool.end();
    },
  };
}
