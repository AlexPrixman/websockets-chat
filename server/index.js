import { configuration } from "./config.js";
import { database } from "./db.js";
import { createApp } from "./app.js";
const config = configuration();
const db = await database(config.databaseUrl);
const runtime = createApp(db, config);
runtime.server.listen(config.port, "0.0.0.0", () =>
  console.log(`CircleChat listening on ${config.port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await runtime.close();
    await db.close();
    process.exit(0);
  });
