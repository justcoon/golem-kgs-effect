import { defineConfig } from "@golemcloud/effect-golem";
import { DatabaseConfigFields } from "./schema.js";

export class DatabaseConfig extends defineConfig(
  "Database.Config",
  DatabaseConfigFields,
) {}
