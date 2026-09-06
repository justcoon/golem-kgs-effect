import { Data, type Effect, type Option } from "effect";
import {
  type RawDocument,
  type ProvenanceRecord,
} from "../domain/provenance.js";
import {
  type SaveCheckpointInput,
  type SyncStatus,
} from "../domain/connector.js";

export class ConnectorError extends Data.TaggedError("ConnectorError")<{
  readonly connectorId: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly status?: number;
}> {}

export interface DiscoveredItem {
  readonly id: string;
  readonly uri: string;
  readonly sizeBytes: number;
  readonly eTag?: string;
  readonly lastModified: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface ExtractedDocument {
  readonly document: RawDocument;
  readonly provenance: ProvenanceRecord;
}

export interface S3CursorData {
  readonly lastSyncTimestamp: string; // ISO 8601 string
  readonly processedKeys: Record<string, string>; // key -> eTag mapping
  readonly continuationToken?: string;
}

export interface SourceConnector<
  _Config,
  Cursor,
  Item extends DiscoveredItem = DiscoveredItem,
> {
  readonly id: string;
  readonly source: string;
  readonly connect: () => Effect.Effect<void, ConnectorError>;
  readonly discover: (
    cursor: Option.Option<Cursor>,
  ) => Effect.Effect<ReadonlyArray<Item>, ConnectorError>;
  readonly fetch: (
    item: Item,
  ) => Effect.Effect<ExtractedDocument, ConnectorError>;
  readonly checkpoint: (
    cursor: Cursor,
    status?: SyncStatus,
    metrics?: Record<string, unknown>,
  ) => SaveCheckpointInput;
}
