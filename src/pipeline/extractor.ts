import { Context, Effect, Layer } from "effect";
import {
  type CreateEntityInput,
  type EntityAlias,
  type EntityType,
} from "../domain/entity.js";
import {
  type CreateEdgeInput,
  type RelationType,
} from "../domain/relationship.js";
import { type CreateChunkInput } from "../domain/chunk.js";

import { type RelationPatternRule } from "../config/schema.js";

export interface ExtractionRules {
  readonly dictionary?: Record<string, string> | ReadonlyMap<string, string>;
  readonly relationPatterns?: ReadonlyArray<RelationPatternRule>;
  readonly stopwords?: ReadonlyArray<string>;
}

export interface ExtractedKnowledge {
  readonly chunkIndex: number;
  readonly documentId: string;
  readonly entities: ReadonlyArray<CreateEntityInput>;
  readonly aliases: ReadonlyArray<EntityAlias>;
  readonly edges: ReadonlyArray<CreateEdgeInput>;
}

export interface ExtractionServiceShape {
  readonly extractFromText: (
    text: string,
    documentId: string,
    chunkIndex?: number,
  ) => Effect.Effect<ExtractedKnowledge>;

  readonly extractFromChunk: (
    chunk: CreateChunkInput,
  ) => Effect.Effect<ExtractedKnowledge>;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class EntityExtractor {
  static extract(
    text: string,
    documentId: string,
    chunkIndex = 0,
    rules?: ExtractionRules,
  ): ExtractedKnowledge {
    const entitiesMap = new Map<string, CreateEntityInput>();
    const aliasesList: EntityAlias[] = [];
    const edgesList: CreateEdgeInput[] = [];

    // Helper to register an entity
    const addEntity = (
      name: string,
      type: EntityType,
      confidence = 0.85,
      description?: string,
    ): string => {
      const canonicalName = name.trim();
      const entityId = `ent_${type.toLowerCase()}_${slugify(canonicalName)}`;
      if (!entitiesMap.has(entityId)) {
        entitiesMap.set(entityId, {
          id: entityId,
          name: canonicalName,
          entityType: type,
          description: description ?? `Extracted from ${documentId}`,
          properties: {
            extractedFromDocument: documentId,
            chunkIndex,
          },
          metadata: {
            confidence,
          },
        });
      }
      return entityId;
    };

    // 1. Detect Acronym Definitions: "Knowledge Graph System (KGS)"
    const acronymRegex = /([A-Z][a-zA-Z0-9\s-]{2,40})\s+\(([A-Z]{2,8})\)/g;
    let match: RegExpExecArray | null;
    while ((match = acronymRegex.exec(text)) !== null) {
      const fullTerm = match[1]?.trim();
      const acronym = match[2]?.trim();

      if (
        fullTerm &&
        acronym &&
        fullTerm.split(/\s+/).length >= 2 &&
        !fullTerm.startsWith("http")
      ) {
        const cleanTerm = fullTerm.replace(/^(the|a|an)\s+/i, "");
        const entityId = addEntity(cleanTerm, "CONCEPT", 0.95);
        aliasesList.push({
          alias: acronym,
          entityId,
          source: "extraction",
          confidence: 0.95,
        });
      }
    }

    // 2. Dictionary-based Entity Recognition
    const lowerText = text.toLowerCase();
    const dictionary = rules?.dictionary ?? {};
    const dictEntries =
      dictionary instanceof Map
        ? dictionary.entries()
        : Object.entries(dictionary);
    for (const [kw, canonical] of dictEntries) {
      const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
      if (regex.test(lowerText)) {
        const entId = addEntity(canonical, "TECHNOLOGY", 0.9);
        if (kw.toLowerCase() !== canonical.toLowerCase()) {
          aliasesList.push({
            alias: kw,
            entityId: entId,
            source: "dictionary",
            confidence: 0.9,
          });
        }
      }
    }

    // 3. Multi-word Title Case Entities
    const stopwordsList = rules?.stopwords ?? [];
    const stopwords = new Set(stopwordsList.map((s) => s.toLowerCase()));
    const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    while ((match = properNounRegex.exec(text)) !== null) {
      const phrase = match[1]?.trim();
      if (phrase && !stopwords.has(phrase.toLowerCase())) {
        const cleanPhrase = phrase.replace(/^(the|a|an)\s+/i, "").trim();
        if (cleanPhrase && !stopwords.has(cleanPhrase.toLowerCase())) {
          addEntity(cleanPhrase, "CONCEPT", 0.75);
        }
      }
    }

    // 4. File and Code References (e.g. `src/main.ts`, `golem.yaml`)
    const fileRefRegex =
      /`([a-zA-Z0-9_./-]+\.(?:ts|js|json|sql|yaml|yml|md))`|`([a-zA-Z0-9_./-]+)`/g;
    while ((match = fileRefRegex.exec(text)) !== null) {
      const fileOrSymbol = (match[1] || match[2] || "").trim();
      if (fileOrSymbol.includes(".") || fileOrSymbol.includes("/")) {
        addEntity(fileOrSymbol, "DOCUMENT", 0.85);
      }
    }

    // 5. Relational Pattern Detection
    const detectedEntities = Array.from(entitiesMap.values());
    if (detectedEntities.length >= 2) {
      const configuredPatterns = rules?.relationPatterns ?? [];

      const matchesEntity = (e: CreateEntityInput, raw: string) => {
        const name = e.name.toLowerCase();
        if (raw.includes(name) || name.includes(raw)) return true;
        return aliasesList.some(
          (a) =>
            a.entityId === e.id &&
            (raw.includes(a.alias.toLowerCase()) ||
              a.alias.toLowerCase().includes(raw)),
        );
      };

      for (const pattern of configuredPatterns) {
        if (!pattern.phrases || pattern.phrases.length === 0) continue;
        const escapedPhrases = pattern.phrases.map(escapeRegex).join("|");
        const globalRegex = new RegExp(
          `([A-Za-z0-9_.-]+(?:\\s+[A-Za-z0-9_.-]+){0,2})\\s+(?:${escapedPhrases})\\s+([A-Za-z0-9_.-]+(?:\\s+[A-Za-z0-9_.-]+){0,2})`,
          "gi",
        );

        let relMatch: RegExpExecArray | null;
        while ((relMatch = globalRegex.exec(text)) !== null) {
          const subjectRaw = (relMatch[1] ?? "").trim().toLowerCase();
          const objectRaw = (relMatch[2] ?? "").trim().toLowerCase();

          if (!subjectRaw || !objectRaw) continue;

          // Find candidate match among detected entities and aliases
          const sourceEntity = detectedEntities.find((e) =>
            matchesEntity(e, subjectRaw),
          );
          const targetEntity = detectedEntities.find((e) =>
            matchesEntity(e, objectRaw),
          );

          if (
            sourceEntity &&
            targetEntity &&
            sourceEntity.id !== targetEntity.id
          ) {
            const relType = pattern.relation as RelationType;
            const edgeId = `edge_${sourceEntity.id}_${relType.toLowerCase()}_${targetEntity.id}`;
            edgesList.push({
              id: edgeId,
              sourceId: sourceEntity.id,
              targetId: targetEntity.id,
              relationType: relType,
              weight: 1.0,
              confidence: pattern.confidence ?? 0.85,
              properties: {
                extractedPattern: relType,
                documentId,
                chunkIndex,
              },
            });
          }
        }
      }
    }

    return {
      chunkIndex,
      documentId,
      entities: Array.from(entitiesMap.values()),
      aliases: aliasesList,
      edges: edgesList,
    };
  }
}

export class ExtractionService extends Context.Service<
  ExtractionService,
  ExtractionServiceShape
>()("app/pipeline/ExtractionService") {
  static readonly make = (rules?: ExtractionRules) =>
    Layer.succeed(ExtractionService, {
      extractFromText: (text: string, documentId: string, chunkIndex = 0) =>
        Effect.sync(() =>
          EntityExtractor.extract(text, documentId, chunkIndex, rules),
        ),

      extractFromChunk: (chunk: CreateChunkInput) =>
        Effect.sync(() =>
          EntityExtractor.extract(
            chunk.content,
            chunk.documentId,
            chunk.chunkIndex,
            rules,
          ),
        ),
    });

  static readonly Default = ExtractionService.make();
}
