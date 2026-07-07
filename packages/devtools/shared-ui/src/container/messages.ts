import * as Schema from "effect/Schema"

export class InitializePanel extends Schema.TaggedClass<InitializePanel>("InitializePanel")("InitializePanel", {
  id: Schema.String,
  title: Schema.String,
  page: Schema.String,
  position: Schema.Literal("side", "main")
}) {}

export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")("Initialized", {}) {}

export const InMessage = Schema.Union(InitializePanel)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(
  Initialized
)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
