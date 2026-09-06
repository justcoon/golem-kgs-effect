import { Effect, Redacted } from "effect";
import { Pg, PgClient } from "@golemcloud/effect-golem/postgres";
import { DatabaseConfig } from "../config/database-config.js";

export { Pg };

export const resolveConnectionAddress = Effect.gen(function* () {
  const config = yield* DatabaseConfig;
  const host = yield* config.db.host;
  const db = yield* config.db.db;
  const port = yield* config.db.port;
  const user = Redacted.value(yield* config.db.user.get);
  const password = Redacted.value(yield* config.db.password.get);

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  return `postgres://${encodedUser}:${encodedPassword}@${host}:${port}/${db}`;
});

export const createPostgresLayer = (connectionAddress: string) =>
  PgClient.layer({
    connectionAddress,
    decodeTemporal: "date",
  });
