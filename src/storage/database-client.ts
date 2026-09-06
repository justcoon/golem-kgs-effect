import { Effect, Redacted } from "effect";
import { Pg, PgClient } from "@golemcloud/effect-golem/postgres";
import { AppAgentConfig } from "../config/agent-config.js";

export { Pg };

export type AppAgentConfigService = typeof AppAgentConfig.Service;

export const resolveConnectionAddress = (configOrDb?: AppAgentConfigService) =>
  Effect.gen(function* () {
    const config = configOrDb ?? (yield* AppAgentConfig);
    const host = yield* config.db.host;
    const db = yield* config.db.db;
    const port = yield* config.db.port;
    const user = Redacted.value(yield* config.db.user.get);
    const password = Redacted.value(yield* config.db.password.get);

    const encodedUser = encodeURIComponent(user);
    const encodedPassword = encodeURIComponent(password);
    return `postgres://${encodedUser}:${encodedPassword}@${host}:${port}/${db}`;
  });

export const createPostgresClient = (configOrDb?: AppAgentConfigService) =>
  Effect.gen(function* () {
    const connectionAddress = yield* resolveConnectionAddress(configOrDb);
    return yield* PgClient.make({
      connectionAddress,
      decodeTemporal: "date",
    });
  });

export const createPostgresLayer = (connectionAddress: string) =>
  PgClient.layer({
    connectionAddress,
    decodeTemporal: "date",
  });
