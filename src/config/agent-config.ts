import { defineConfig } from "@golemcloud/effect-golem";
import {
  DatabaseConfigFields,
  EmbeddingConfigFields,
  ResourcesConfigFields,
} from "./schema.js";

export class AppAgentConfig extends defineConfig("AppAgent.Config", {
  ...DatabaseConfigFields,
  ...EmbeddingConfigFields,
  ...ResourcesConfigFields,
}) {}
