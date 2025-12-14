import type { Result } from "@effect-atom/atom-react"
import { Atom } from "@effect-atom/atom-react"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { VscodeTreeItem } from "../components/index.ts"
import * as WebviewMessaging from "../WebviewMessaging.ts"
import {
  Initialized,
  InMessage,
  OutMessage,
  SpanDataForDetailsInfo,
  SpanDataForDetailsRequest,
  SpanDataForListInfo,
  SpanDataForListRequest,
  SpanId,
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
    const expandedSpanIds = yield* SubscriptionRef.make(HashSet.empty<SpanId>())

    const ofType = <A extends Schema.Schema.AnyNoContext>(
      schema: A
    ): Stream.Stream<Schema.Schema.Type<A>> =>
      Stream.fromPubSub(events).pipe(
        Stream.filterMap(Schema.decodeUnknownOption(schema)),
        Stream.changes
      )

    const request = (value: OutMessage) =>
      Schema.encodeUnknown(OutMessage)(value).pipe(
        Effect.tap((_) => Effect.log("<--", _)),
        Effect.flatMap(postMessage),
        Effect.ignoreLogged
      )

    yield* ofType(InMessage).pipe(
      Stream.tap((_) => Effect.log("-->", _)),
      Stream.runDrain,
      Effect.forkScoped
    )

    return {
      ofType,
      request,
      currentTraceId,
      selectedSpanId,
      expandedSpanIds
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
    const expandedSpanIds = yield* SubscriptionRef.get(tracerApp.expandedSpanIds)
    yield* tracerApp.request(new SpanListRequest({ traceId, expandedSpanIds }))
    yield* tracerApp.request(new UsedRangeRequest())
  })
)

export const currentSpanIdsAtom: Atom.Atom<Result.Result<ReadonlyArray<SpanId>, never>> = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return Stream.zipLatestWith(
      tracerApp.currentTraceId.changes,
      tracerApp.expandedSpanIds.changes,
      (traceId, expandedSpanIds) => ({ traceId, expandedSpanIds })
    ).pipe(
      Stream.flatMap(({ expandedSpanIds, traceId }) =>
        Stream.empty.pipe(
          Stream.merge(tracerApp.ofType(SpanListInfo)),
          Stream.tap((_) => Effect.log("spans", _.spanIds.length)),
          Stream.filter((_) => Equal.equals(traceId, _.traceId)),
          Stream.map((_) => _.spanIds),
          Stream.onStart(tracerApp.request(new SpanListRequest({ traceId, expandedSpanIds })))
        ), { switch: true }),
      Stream.merge(Stream.succeed([]))
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

export const selectedSpanIdAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return tracerApp.selectedSpanId.changes
  }).pipe(Stream.unwrap)
)

export const setSelectedSpanIdAtom = tracerRuntime.fn((e: CustomEvent<Array<VscodeTreeItem>>) =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    if (e.detail.length > 0) {
      const spanId = e.detail[0].getAttribute("data-span-id")
      const traceId = e.detail[0].getAttribute("data-trace-id")
      if (spanId && traceId) {
        return yield* SubscriptionRef.set(tracerApp.selectedSpanId, Option.some(new SpanId({ traceId, spanId })))
      }
    }
    return yield* SubscriptionRef.set(tracerApp.selectedSpanId, Option.none<SpanId>())
  })
)

export const selectedSpanDetailsAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return tracerApp.selectedSpanId.changes.pipe(Stream.flatMap(
      Option.match({
        onSome: (spanId) =>
          tracerApp.ofType(SpanDataForDetailsInfo).pipe(
            Stream.filter((_) => Equal.equals(_.spanId, spanId)),
            Stream.map((_) => Option.some(_)),
            Stream.onStart(tracerApp.request(new SpanDataForDetailsRequest({ spanId })))
          ),
        onNone: () => Stream.succeed(Option.none<SpanDataForDetailsInfo>())
      }),
      { switch: true }
    ))
  }).pipe(Stream.unwrap)
)

export const toggleSpanIdAtom = Atom.family((spanId: SpanId) =>
  tracerRuntime.fn((_: any) =>
    Effect.gen(function*() {
      const tracerApp = yield* TracerApp
      return yield* SubscriptionRef.update(
        tracerApp.expandedSpanIds,
        (expandedSpanIds) =>
          HashSet.has(expandedSpanIds, spanId)
            ? HashSet.remove(expandedSpanIds, spanId)
            : HashSet.add(expandedSpanIds, spanId)
      )
    })
  )
)

export const isSpanIdExpandedAtom = Atom.family((spanId: SpanId) =>
  tracerRuntime.atom(() =>
    Effect.gen(function*() {
      const tracerApp = yield* TracerApp
      return tracerApp.expandedSpanIds.changes.pipe(
        Stream.map((expandedSpanIds) => {
          return HashSet.has(expandedSpanIds, spanId)
        })
      )
    }).pipe(Stream.unwrap)
  )
)
