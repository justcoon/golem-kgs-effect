import { defineConfig } from "@golemcloud/effect-golem";
import {
  DatabaseConfigFields,
  EmbeddingConfigFields,
  ExtractionConfigFields,
  ResourcesConfigFields,
} from "./schema.js";

export class AppAgentConfig extends defineConfig("AppAgent.Config", {
  ...DatabaseConfigFields,
  ...EmbeddingConfigFields,
  ...ResourcesConfigFields,
  ...ExtractionConfigFields,
}) {}

export type AppAgentConfigService = typeof AppAgentConfig.Service;
