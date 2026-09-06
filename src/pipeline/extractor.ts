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

// Common technology dictionary for high-precision recognition
const KNOWN_TECHNOLOGIES = new Map<string, string>([
  ["golem", "Golem Cloud"],
  ["golem cloud", "Golem Cloud"],
  ["effect", "Effect-TS"],
  ["typescript", "TypeScript"],
  ["postgresql", "PostgreSQL"],
  ["postgres", "PostgreSQL"],
  ["pgvector", "pgvector"],
  ["docker", "Docker"],
  ["rustfs", "RustFS"],
  ["ollama", "Ollama"],
  ["s3", "Amazon S3"],
  ["aws", "Amazon Web Services"],
  ["wasm", "WebAssembly"],
  ["webassembly", "WebAssembly"],
  ["quickjs", "QuickJS"],
  ["hnsw", "HNSW Index"],
  ["rrf", "Reciprocal Rank Fusion"],
  ["graphrag", "GraphRAG"],
]);

export class EntityExtractor {
  static extract(
    text: string,
    documentId: string,
    chunkIndex = 0,
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

    // 2. Known Technology Match
    const lowerText = text.toLowerCase();
    for (const [kw, canonical] of KNOWN_TECHNOLOGIES.entries()) {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      if (regex.test(lowerText)) {
        addEntity(canonical, "TECHNOLOGY", 0.9);
      }
    }

    // 3. Multi-word Title Case Entities (e.g. "Durable Execution Engine", "Storage Substrate")
    const properNounRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
    while ((match = properNounRegex.exec(text)) !== null) {
      const phrase = match[1]?.trim();
      if (
        phrase &&
        !["Table Of", "The Following", "For Example", "In Addition"].includes(
          phrase,
        )
      ) {
        addEntity(phrase, "CONCEPT", 0.75);
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
      const relationPatterns: {
        regex: RegExp;
        relation: RelationType;
        confidence: number;
      }[] = [
        {
          regex:
            /([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})\s+(?:depends on|requires|relies on|uses|utilizes|leverages)\s+([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})/i,
          relation: "DEPENDS_ON",
          confidence: 0.85,
        },
        {
          regex:
            /([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})\s+(?:authored by|written by|created by)\s+([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})/i,
          relation: "AUTHORED_BY",
          confidence: 0.9,
        },
        {
          regex:
            /([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})\s+(?:is part of|belongs to|member of)\s+([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})/i,
          relation: "PART_OF",
          confidence: 0.85,
        },
        {
          regex:
            /([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})\s+(?:contains|includes|references|mentions|points to|relates to)\s+([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+){0,2})/i,
          relation: "RELATES_TO",
          confidence: 0.8,
        },
      ];

      for (const pattern of relationPatterns) {
        let relMatch: RegExpExecArray | null;
        const globalRegex = new RegExp(pattern.regex.source, "gi");
        while ((relMatch = globalRegex.exec(text)) !== null) {
          const subjectRaw = (relMatch[1] ?? "").trim().toLowerCase();
          const objectRaw = (relMatch[2] ?? "").trim().toLowerCase();

          if (!subjectRaw || !objectRaw) continue;

          // Find candidate match among detected entities
          const sourceEntity = detectedEntities.find(
            (e) =>
              subjectRaw.includes(e.name.toLowerCase()) ||
              e.name.toLowerCase().includes(subjectRaw),
          );
          const targetEntity = detectedEntities.find(
            (e) =>
              objectRaw.includes(e.name.toLowerCase()) ||
              e.name.toLowerCase().includes(objectRaw),
          );

          if (
            sourceEntity &&
            targetEntity &&
            sourceEntity.id !== targetEntity.id
          ) {
            const edgeId = `edge_${sourceEntity.id}_${pattern.relation.toLowerCase()}_${targetEntity.id}`;
            edgesList.push({
              id: edgeId,
              sourceId: sourceEntity.id,
              targetId: targetEntity.id,
              relationType: pattern.relation,
              weight: 1.0,
              confidence: pattern.confidence,
              properties: {
                extractedPattern: pattern.relation,
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
  static readonly Default = Layer.succeed(ExtractionService, {
    extractFromText: (text: string, documentId: string, chunkIndex = 0) =>
      Effect.sync(() => EntityExtractor.extract(text, documentId, chunkIndex)),

    extractFromChunk: (chunk: CreateChunkInput) =>
      Effect.sync(() =>
        EntityExtractor.extract(
          chunk.content,
          chunk.documentId,
          chunk.chunkIndex,
        ),
      ),
  });
}
