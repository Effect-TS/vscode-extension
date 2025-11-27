import type * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import * as ConfigWebView from "@effect/devtools-shared/webviews/config.generated"
import * as Effect from "effect/Effect"
import * as JSONSchema from "effect/JSONSchema"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

export const WebView = ExtWebView.make("effect-config", {
  title: "Config",
  type: "config"
})

export const layer = Layer.unwrapScoped(Effect.gen(function*() {
  const extHost = yield* ExtHost.ExtHost
  const configs = new Map<string, ExtConfig.AnyWithProps>()

  const configWebViewLive = WebView.toLayer(
    (send, queue) =>
      Effect.gen(function*() {
        const request = (message: ConfigWebView.InMessage) =>
          Schema.encodeUnknown(ConfigWebView.InMessage)(message).pipe(
            Effect.flatMap(send),
            Effect.ignoreLogged
          )

        yield* Mailbox.toStream(queue).pipe(
          Stream.filterMap(Schema.decodeUnknownOption(ConfigWebView.OutMessage)),
          Stream.mapEffect((_) =>
            Effect.gen(function*() {
              switch (_._tag) {
                case "Initialized": {
                  return yield* request(new ConfigWebView.InvalidatedIds({ itemIds: Option.none() }))
                }
                case "RequestConfigList": {
                  return yield* request(new ConfigWebView.ConfigList({ configIds: Array.from(configs.keys()) }))
                }
                case "RequestConfigInfo": {
                  const config = yield* Option.fromNullable(configs.get(_.configId))
                  const schema = yield* Effect.try({
                    try: () => JSONSchema.make(config.schema),
                    catch: () => new Error("Failed to convert config schema to JSON schema")
                  })
                  const valueRef = yield* extHost.readConfig(config)
                  return yield* request(
                    new ConfigWebView.ConfigInfo({
                      id: config._id,
                      title: config.title,
                      description: config.description,
                      info: {
                        value: yield* valueRef.get,
                        type: (schema && "type" in schema ? schema.type : "string") as any,
                        items: (schema && "items" in schema ? schema.items : undefined) as any
                      }
                    })
                  )
                }
              }
            }).pipe(Effect.ignoreLogged)
          ),
          Stream.runDrain,
          Effect.forkScoped
        )
      })
  )

  return Layer.succeed(ExtHost.ExtHost, {
    ...extHost,
    registerConfig: (config) =>
      extHost.registerConfig(config).pipe(
        Effect.zipRight(Effect.sync(() => configs.set(config._id, config)))
      )
  }).pipe(
    Layer.provideMerge(configWebViewLive)
  )
}))
