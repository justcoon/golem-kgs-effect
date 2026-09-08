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

import {
  type CooccurrenceConfig,
  type DictionaryEntry,
  type RelationPatternRule,
} from "../config/schema.js";

export interface ExtractionRules {
  readonly dictionary?:
    | Record<string, string>
    | ReadonlyMap<string, string>
    | ReadonlyArray<DictionaryEntry>;
  readonly relationPatterns?: ReadonlyArray<RelationPatternRule>;
  readonly stopwords?: ReadonlyArray<string>;
  readonly cooccurrence?: CooccurrenceConfig;
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

function findEntityFirstIndex(
  entity: CreateEntityInput,
  aliases: ReadonlyArray<EntityAlias>,
  windowText: string,
): number {
  const lowerWindow = windowText.toLowerCase();
  const searchTerms = [
    entity.name,
    ...aliases.filter((a) => a.entityId === entity.id).map((a) => a.alias),
  ];
  let minIndex = -1;

  for (const term of searchTerms) {
    if (!term || term.trim().length === 0) continue;
    const lowerTerm = term.toLowerCase().trim();
    const isAlphanumeric =
      /^[a-z0-9]/i.test(lowerTerm) && /[a-z0-9]$/i.test(lowerTerm);
    if (isAlphanumeric) {
      const regex = new RegExp(`\\b${escapeRegex(lowerTerm)}\\b`, "i");
      const match = regex.exec(lowerWindow);
      if (match) {
        if (minIndex === -1 || match.index < minIndex) {
          minIndex = match.index;
        }
      }
    } else {
      const idx = lowerWindow.indexOf(lowerTerm);
      if (idx !== -1) {
        if (minIndex === -1 || idx < minIndex) {
          minIndex = idx;
        }
      }
    }
  }

  return minIndex;
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
      const slug = slugify(canonicalName);

      // Check if an entity with this slug already exists across any entity type
      for (const existing of entitiesMap.values()) {
        if (slugify(existing.name) === slug) {
          return existing.id;
        }
      }

      const entityId = `ent_${type.toLowerCase()}_${slug}`;
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
    const dictionary = rules?.dictionary ?? [];
    const dictEntries: [string, string][] = Array.isArray(dictionary)
      ? dictionary.map((d: DictionaryEntry) => [d.alias, d.canonical])
      : dictionary instanceof Map
        ? Array.from(dictionary.entries())
        : Object.entries(dictionary);
    for (const [kw, canonical] of dictEntries) {
      const kwRegex = new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
      const canonicalRegex = new RegExp(`\\b${escapeRegex(canonical)}\\b`, "i");
      const kwMatched = kwRegex.test(lowerText);
      const canonicalMatched = canonicalRegex.test(lowerText);
      if (kwMatched || canonicalMatched) {
        const entId = addEntity(canonical, "TECHNOLOGY", 0.9);
        if (kwMatched && kw.toLowerCase() !== canonical.toLowerCase()) {
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
            edgesList.push({
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

    // 6. Co-occurrence Edge Extraction
    if (rules?.cooccurrence?.enabled && detectedEntities.length >= 2) {
      const windowMode = rules.cooccurrence.window ?? "sentence";
      const relationType = (rules.cooccurrence.relation ??
        "CO_OCCURS_WITH") as RelationType;
      const confidence = rules.cooccurrence.confidence ?? 0.75;
      const maxEdges = rules.cooccurrence.maxEdgesPerChunk ?? 25;

      const windows =
        windowMode === "chunk"
          ? [text]
          : text
              .split(/(?<=[.!?])\s+|\n+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0);

      const seenPairs = new Set<string>();
      let cooccurrenceCount = 0;

      for (const win of windows) {
        if (cooccurrenceCount >= maxEdges) break;

        const entitiesInWindow: Array<{
          entity: CreateEntityInput;
          pos: number;
        }> = [];

        for (const ent of detectedEntities) {
          const pos = findEntityFirstIndex(ent, aliasesList, win);
          if (pos !== -1) {
            entitiesInWindow.push({ entity: ent, pos });
          }
        }

        if (entitiesInWindow.length < 2) continue;

        entitiesInWindow.sort((a, b) => a.pos - b.pos);

        for (let i = 0; i < entitiesInWindow.length; i++) {
          for (let j = i + 1; j < entitiesInWindow.length; j++) {
            if (cooccurrenceCount >= maxEdges) break;

            const itemI = entitiesInWindow[i];
            const itemJ = entitiesInWindow[j];
            if (!itemI || !itemJ) continue;

            const first = itemI.entity;
            const second = itemJ.entity;
            if (first.id === second.id) continue;

            const pairKey = [first.id, second.id].sort().join("<->");
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            edgesList.push({
              sourceId: first.id,
              targetId: second.id,
              relationType,
              weight: 1.0,
              confidence,
              properties: {
                extractedPattern: "CO_OCCURRENCE",
                documentId,
                chunkIndex,
                window: windowMode,
              },
            });
            cooccurrenceCount++;
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
