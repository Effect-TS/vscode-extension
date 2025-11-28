import * as Effect from "effect/Effect"
import * as JSONSchema from "effect/JSONSchema"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as ExtConfig from "../core/ExtConfig.ts"
import * as ExtHost from "../core/ExtHost.ts"
import * as ExtWebView from "../core/ExtWebView.ts"
import * as ConfigWebView from "../webviews/config.generated.ts"

export const WebView = ExtWebView.make("effect-config", {
  title: "Config",
  type: "config"
})

export const layer = (_saveConfig: (config: ExtConfig.AnyWithProps, value: any) => Effect.Effect<void>) =>
  Layer.unwrapScoped(Effect.gen(function*() {
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

          yield* queue.take.pipe(
            Effect.flatMap((encoded) =>
              Effect.gen(function*() {
                const _ = yield* Schema.decodeUnknown(ConfigWebView.OutMessage)(encoded)
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
            Effect.forever,
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
