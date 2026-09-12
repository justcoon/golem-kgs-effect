import { defineConfig } from "@golemcloud/effect-golem";
import {
  DatabaseConfigFields,
  EmbeddingConfigFields,
  ExtractionConfigFields,
  LlmConfigFields,
  ResourcesConfigFields,
} from "./schema.js";

export class AppAgentConfig extends defineConfig("AppAgent.Config", {
  ...DatabaseConfigFields,
  ...EmbeddingConfigFields,
  ...LlmConfigFields,
  ...ResourcesConfigFields,
  ...ExtractionConfigFields,
}) {}

export type AppAgentConfigService = typeof AppAgentConfig.Service;
