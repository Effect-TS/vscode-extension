import * as Schema from "effect/Schema"

export class Initialize extends Schema.TaggedClass<Initialize>("Initialize")("Initialize", {}) {}
export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")("Initialized", {}) {}

export class InvalidatedIds extends Schema.TaggedClass<InvalidatedIds>("InvalidatedIds")("InvalidatedIds", {
  itemIds: Schema.Option(Schema.Array(Schema.NonEmptyString))
}) {}

export class RequestConfigList
  extends Schema.TaggedClass<RequestConfigList>("RequestConfigList")("RequestConfigList", {})
{}

export class ConfigList extends Schema.TaggedClass<ConfigList>("ConfigList")("ConfigList", {
  configIds: Schema.Array(Schema.NonEmptyString)
}) {}

export class RequestConfigInfo extends Schema.TaggedClass<RequestConfigInfo>("RequestConfigInfo")("RequestConfigInfo", {
  configId: Schema.NonEmptyString
}) {}

export const ConfigValueWithType = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("integer"),
    value: Schema.Int
  }),
  Schema.Struct({
    type: Schema.Literal("boolean"),
    value: Schema.Boolean
  }),
  Schema.Struct({
    type: Schema.Literal("array"),
    items: Schema.Struct({
      type: Schema.Literal("string")
    }),
    value: Schema.Array(Schema.String)
  })
)
export type ConfigValueWithType = Schema.Schema.Type<typeof ConfigValueWithType>

export class ConfigInfo extends Schema.TaggedClass<ConfigInfo>("ConfigInfo")("ConfigInfo", {
  id: Schema.NonEmptyString,
  title: Schema.String,
  description: Schema.String,
  info: ConfigValueWithType
}) {}

export class RequestSaveConfig extends Schema.TaggedClass<RequestSaveConfig>("RequestSaveConfig")("RequestSaveConfig", {
  configId: Schema.NonEmptyString,
  value: ConfigValueWithType
}) {}

export const InMessage = Schema.Union(Initialize, ConfigList, ConfigInfo, InvalidatedIds)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(
  Initialized,
  RequestConfigList,
  RequestConfigInfo,
  RequestSaveConfig
)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
