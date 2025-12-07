import type { Result } from "@effect-atom/atom-react"
import { Atom } from "@effect-atom/atom-react"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as WebviewMessaging from "../WebviewMessaging.ts"
import { Initialized, OutMessage, SpanListInfo, SpanListRequest, TraceListInfo, TraceListRequest } from "./messages.ts"

export class TracerApp extends Effect.Service<TracerApp>()("TracerApp", {
  dependencies: [WebviewMessaging.layer(Schema.encodeUnknownSync(Initialized)(new Initialized()))],
  scoped: Effect.gen(function*() {
    const { events, postMessage } = yield* WebviewMessaging.WebviewMessaging

    const currentTraceId = yield* SubscriptionRef.make(Option.none<string>())

    const ofType = <A extends Schema.Schema.AnyNoContext>(
      schema: A
    ): Stream.Stream<Schema.Schema.Type<A>> =>
      Stream.fromPubSub(events).pipe(
        Stream.filterMap(Schema.decodeUnknownOption(schema)),
        Stream.changes
      )

    const request = (value: OutMessage) =>
      Schema.encodeUnknown(OutMessage)(value).pipe(
        Effect.flatMap(postMessage),
        Effect.ignoreLogged
      )

    yield* ofType(TraceListInfo).pipe(
      Stream.mapEffect((_) => SubscriptionRef.set(currentTraceId, Option.fromNullable(_.traceIds[0]))),
      Stream.changes,
      Stream.runDrain,
      Effect.forkScoped
    )

    return {
      ofType,
      request,
      currentTraceId
    }
  })
}) {}

const tracerRuntime = Atom.runtime(TracerApp.Default).pipe(Atom.keepAlive)

const currentTraceIdAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    yield* tracerApp.request(new TraceListRequest())
    return tracerApp.currentTraceId.changes
  }).pipe(Stream.unwrap)
)

export const currentSpanIdsAtom: Atom.Atom<Result.Result<ReadonlyArray<string>, never>> = tracerRuntime.atom((ctx) =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    const currentTraceId = yield* ctx.result(currentTraceIdAtom)
    if (Option.isNone(currentTraceId)) return Stream.succeed([])
    return tracerApp.ofType(SpanListInfo).pipe(
      Stream.filter((_) => _.traceId === currentTraceId.value),
      Stream.map((_) => _.spanIds),
      Stream.onStart(tracerApp.request(new SpanListRequest({ traceId: currentTraceId.value, expandedSpanIds: [] }))),
      Stream.changes
    )
  }).pipe(Stream.unwrap)
)
