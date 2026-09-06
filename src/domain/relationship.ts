import { Schema } from "effect";

export const RelationType = Schema.Literals([
  "AUTHORED_BY",
  "DEPENDS_ON",
  "PART_OF",
  "DISCUSSES",
  "OWNS",
  "RELATES_TO",
  "MEMBER_OF",
  "MENTIONS",
]);
export type RelationType = typeof RelationType.Type;

export const EdgeDirection = Schema.Literals(["OUTBOUND", "INBOUND", "BOTH"]);
export type EdgeDirection = typeof EdgeDirection.Type;

export const Edge = Schema.Struct({
  id: Schema.String,
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.Number,
  confidence: Schema.Number,
  properties: Schema.Record(Schema.String, Schema.Unknown),
  validFrom: Schema.NullOr(Schema.Date),
  validUntil: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type Edge = typeof Edge.Type;

export const CreateEdgeInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  sourceId: Schema.String,
  targetId: Schema.String,
  relationType: Schema.String,
  weight: Schema.optional(Schema.Number),
  confidence: Schema.optional(Schema.Number),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  validFrom: Schema.optional(Schema.NullOr(Schema.Date)),
  validUntil: Schema.optional(Schema.NullOr(Schema.Date)),
});
export type CreateEdgeInput = typeof CreateEdgeInput.Type;
