import { Schema } from "effect";

export const DefaultRelationTypes = [
  "AUTHORED_BY",
  "DEPENDS_ON",
  "PART_OF",
  "DISCUSSES",
  "OWNS",
  "RELATES_TO",
  "MEMBER_OF",
  "MENTIONS",
  "CO_OCCURS_WITH",
] as const;

export const RelationType = Schema.String;
export type RelationType = typeof RelationType.Type;

export const EdgeDirection = Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"]);
export type EdgeDirection = typeof EdgeDirection.Type;

export const Edge = Schema.Struct({
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.Number,
  confidence: Schema.Number,
  properties: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type Edge = typeof Edge.Type;

export const CreateEdgeInput = Schema.Struct({
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type CreateEdgeInput = typeof CreateEdgeInput.Type;
