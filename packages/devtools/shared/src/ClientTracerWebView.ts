import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as ExtHost from "./core/ExtHost.ts"
import * as ExtWebView from "./core/ExtWebView.ts"
import * as Clients from "./DevtoolClients.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"

export class Booted extends Schema.TaggedClass<Booted>()("Booted", {}) {}
export class ResetTracer extends Schema.TaggedClass<ResetTracer>()("ResetTracer", {}) {}
export class GoToLocation extends Schema.TaggedClass<GoToLocation>()("GoToLocation", {
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int
}) {}

export const WebviewMessage = Schema.Union(Booted, GoToLocation)
const HostMessage = Schema.Union(ResetTracer, Domain.Span, Domain.SpanEvent)

export const ClientTracerWebView = ExtWebView.make("effect-tracer-extended", {
  title: "Tracer",
  type: "tracer"
})

export const ClientTracerWebViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const resetHub = yield* PubSub.sliding<void>({ capacity: 2 })

  const resetTracer = DevtoolCommands.ResetTracerExtended.toLayer(
    Effect.succeed(() => PubSub.publish(resetHub, void 0))
  )

  const treeView = ClientTracerWebView.toLayer((request, queue) =>
    Effect.gen(function*() {
      const booted = yield* Deferred.make<void>()
      const extHost = yield* ExtHost.ExtHost
      const clients = yield* Clients.DevtoolClients

      yield* queue.take.pipe(
        Effect.flatMap(Schema.decodeUnknown(WebviewMessage)),
        Effect.flatMap((message) =>
          Effect.gen(function*() {
            switch (message._tag) {
              case "Booted": {
                yield* Deferred.succeed(booted, void 0)
                break
              }
              case "GoToLocation": {
                const { column, line, path } = message
                yield* extHost.revealFileLineColumnRange(path, line, column, line, column)
                break
              }
            }
          })
        ),
        Effect.ignoreLogged,
        Effect.forever,
        Effect.forkScoped
      )

      const handleClient = (client: Clients.Client) =>
        Effect.gen(function*() {
          const spans = yield* client.spans
          return yield* spans.take.pipe(
            Effect.flatMap(Schema.encodeUnknown(HostMessage)),
            Effect.flatMap(request),
            Effect.ignoreLogged,
            Effect.forever
          )
        }).pipe(Effect.scoped)

      yield* clients.clients.changes.pipe(
        Stream.flatMap(
          Effect.forEach(handleClient, { concurrency: "unbounded" }),
          { switch: true }
        ),
        Stream.runDrain,
        Effect.forkScoped
      )

      yield* Stream.fromPubSub(resetHub).pipe(
        Stream.mapEffect(() => Schema.encodeUnknown(ResetTracer)(new ResetTracer())),
        Stream.mapEffect(request),
        Stream.runDrain,
        Effect.forkScoped
      )
    })
  )

  return treeView.pipe(Layer.provideMerge(resetTracer))
}))
