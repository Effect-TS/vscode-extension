import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Array from "effect/Array"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as ExtHostDebugger from "./core/ExtHostDebugger.ts"
import type * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import * as Clients from "./DevtoolClients.ts"
import * as Commands from "./DevtoolCommands.ts"
import * as Configs from "./DevtoolConfigs.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"

export const DebugInstrumentationResponseSchema = Schema.parseJson(Schema.Struct({
  instrumentationId: Schema.String,
  responses: Schema.Array(Domain.Request)
}))

export const ClientsCommandsLive = Layer.unwrapScoped(Effect.gen(function*() {
  const hostDebugger = yield* ExtHostDebugger.ExtHostDebugger
  const pollMillis = yield* Configs.TracerPollInterval
  const { makeClient } = yield* Clients.DevtoolClients

  const scope = yield* Effect.scope

  // keeps a list of known debug sessions and those already attached to a client
  const attachedDebugSessions = new WeakSet<ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
  const attachDebugSessionClient = (debugConnection: ExtHostDebuggerConnection.ExtHostDebuggerConnection) =>
    Effect.gen(function*() {
      let instrumentationId: string | undefined
      // do not double attach
      if (attachedDebugSessions.has(debugConnection)) return

      // create a debug channel for the session
      const queue = yield* Mailbox.make<Domain.Request, never>({
        capacity: 256,
        strategy: "sliding"
      })
      const toSend = yield* Queue.unbounded<Domain.Response>()

      // a fiber that takes requests to send to the client or pulls every interval
      const sendReceiveFiber = yield* pipe(
        Queue.takeBetween(toSend, 1, 100),
        Effect.raceFirst(
          Effect.flatMap(
            pollMillis.get,
            (millis) => Effect.sleep(millis).pipe(Effect.as(Chunk.empty<Domain.Response>()))
          )
        ),
        Effect.flatMap((requests) =>
          Effect.gen(function*() {
            const encodedRequests = yield* Schema.encode(Schema.Chunk(Domain.Response))(requests)
            const requestJs = `globalThis["effect/devtools/instrumentation"].debugProtocolDevtoolsClient(${
              JSON.stringify(encodedRequests)
            })`
            const debugResponses = yield* DevtoolDebugBridge.evaluateEnsuringInstrumentationInjected(
              debugConnection,
              requestJs,
              false,
              undefined
            )

            const result = yield* debugResponses.parse(DebugInstrumentationResponseSchema)

            // once we received an instrumentation id, we ensure it is always the same
            if (!instrumentationId) instrumentationId = result.instrumentationId
            if (instrumentationId !== result.instrumentationId) {
              return yield* Effect.interrupt
            }

            return yield* queue.offerAll(result.responses)
          }).pipe(Effect.scoped)
        ),
        Effect.tapErrorCause(Effect.logError),
        Effect.forever,
        Effect.ensuring(queue.shutdown),
        Effect.ensuring(Effect.sync(() => attachedDebugSessions.delete(debugConnection))),
        Effect.forkIn(scope)
      )

      // kill the client upon session termination
      yield* debugConnection.events.awaitShutdown.pipe(
        Effect.ensuring(Fiber.interrupt(sendReceiveFiber)),
        Effect.forkIn(scope)
      )

      attachedDebugSessions.add(debugConnection)

      yield* makeClient({
        queue: queue as any,
        request: (_) => toSend.offer(_)
      }, debugConnection.name)
    }).pipe(
      Effect.ignoreLogged,
      Effect.scoped,
      Effect.forkIn(scope)
    )

  const attachCommand = Commands.AttachDebugSessionClient.toLayer(Effect.gen(function*() {
    return () =>
      Effect.gen(function*() {
        const debugSessions = yield* hostDebugger.connections.get
        // heuristic that places before clients with ".ts" in the name
        const sessions = Array.fromIterable(debugSessions)
        sessions.sort((a, b) => {
          const aTs = a.name.includes(".ts")
          const bTs = b.name.includes(".ts")
          if (aTs && !bTs) return -1
          if (!aTs && bTs) return 1
          return 0
        })
        // attach them
        return yield* Effect.forEach(sessions, attachDebugSessionClient)
      })
  }))

  return attachCommand
})).pipe(Layer.provideMerge(Configs.TracerPollInterval.toLayer()))
