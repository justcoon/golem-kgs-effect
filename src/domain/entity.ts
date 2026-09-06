import { Schema } from "effect";

export const EntityType = Schema.Literals([
  "PERSON",
  "ORGANIZATION",
  "TECHNOLOGY",
  "CONCEPT",
  "DOCUMENT",
  "LOCATION",
  "OTHER",
]);
export type EntityType = typeof EntityType.Type;

export const EntityAlias = Schema.Struct({
  alias: Schema.String,
  entityId: Schema.String,
  source: Schema.optional(Schema.String),
  confidence: Schema.optional(Schema.Number),
  createdAt: Schema.optional(Schema.Date),
});
export type EntityAlias = typeof EntityAlias.Type;

export const Entity = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  entityType: EntityType,
  description: Schema.NullOr(Schema.String),
  properties: Schema.Record(Schema.String, Schema.Unknown),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type Entity = typeof Entity.Type;

export const CreateEntityInput = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  entityType: EntityType,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type CreateEntityInput = typeof CreateEntityInput.Type;

export const UpdateEntityInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  entityType: Schema.optional(EntityType),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  properties: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type UpdateEntityInput = typeof UpdateEntityInput.Type;
