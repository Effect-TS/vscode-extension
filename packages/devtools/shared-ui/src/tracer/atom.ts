import type { Result } from "@effect-atom/atom-react"
import { Atom } from "@effect-atom/atom-react"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as WebviewMessaging from "../WebviewMessaging.ts"
import type { SpanId } from "./messages.ts"
import {
  Initialized,
  InMessage,
  OutMessage,
  SpanDataForListInfo,
  SpanDataForListRequest,
  SpanListInfo,
  SpanListRequest,
  TraceListRequest,
  UsedRangeInfo,
  UsedRangeRequest
} from "./messages.ts"

export class TracerApp extends Effect.Service<TracerApp>()("TracerApp", {
  dependencies: [WebviewMessaging.layer(Schema.encodeUnknownSync(Initialized)(new Initialized()))],
  scoped: Effect.gen(function*() {
    const { events, postMessage } = yield* WebviewMessaging.WebviewMessaging

    const currentTraceId = yield* SubscriptionRef.make(Option.none<string>())
    const selectedSpanId = yield* SubscriptionRef.make(Option.none<SpanId>())

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

    yield* ofType(InMessage).pipe(
      Stream.tap(Effect.log),
      Stream.runDrain,
      Effect.forkScoped
    )

    return {
      ofType,
      request,
      currentTraceId,
      selectedSpanId
    }
  })
}) {}

const tracerRuntime = Atom.runtime(TracerApp.Default).pipe(Atom.keepAlive)

export const usedRangeAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return Stream.succeed(new UsedRangeInfo({ startTime: BigInt(1), endTime: BigInt(-1) })).pipe(
      Stream.merge(tracerApp.ofType(UsedRangeInfo)),
      Stream.map((_) => [_.startTime, _.endTime]),
      Stream.onStart(tracerApp.request(new UsedRangeRequest()))
    )
  }).pipe(Stream.unwrap)
)

export const refreshApp = tracerRuntime.fn((_: any) =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    yield* tracerApp.request(new TraceListRequest())
    const traceId = yield* SubscriptionRef.get(tracerApp.currentTraceId)
    yield* tracerApp.request(new SpanListRequest({ traceId, expandedSpanIds: [] }))
    yield* tracerApp.request(new UsedRangeRequest())
  })
)

const currentTraceIdAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    yield* tracerApp.request(new TraceListRequest())
    return tracerApp.currentTraceId.changes
  }).pipe(Stream.unwrap, Stream.tap(Effect.log))
)

export const currentSpanIdsAtom: Atom.Atom<Result.Result<ReadonlyArray<SpanId>, never>> = tracerRuntime.atom((ctx) =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return ctx.streamResult(currentTraceIdAtom).pipe(
      Stream.flatMap((traceId) =>
        Stream.succeed(new SpanListInfo({ traceId, spanIds: [] })).pipe(
          Stream.merge(tracerApp.ofType(SpanListInfo)),
          Stream.filter((_) => Equal.equals(traceId, _.traceId)),
          Stream.map((_) => _.spanIds),
          Stream.onStart(tracerApp.request(new SpanListRequest({ traceId, expandedSpanIds: [] })))
        ), { switch: true }),
      Stream.tap((_) => Effect.log("spanids", _))
    )
  }).pipe(Stream.unwrap)
)

export const spanDataForListAtom = Atom.family((spanId: SpanId) =>
  tracerRuntime.atom(() =>
    Effect.gen(function*() {
      const tracerApp = yield* TracerApp
      return tracerApp.ofType(SpanDataForListInfo).pipe(
        Stream.filter((_) => Equal.equals(_.spanId, spanId)),
        Stream.onStart(tracerApp.request(new SpanDataForListRequest({ spanId })))
      )
    }).pipe(Stream.unwrap)
  )
)
