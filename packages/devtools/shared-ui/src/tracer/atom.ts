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
  MinimapDataInfo,
  MinimapDataRequest,
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
  dependencies: [
    WebviewMessaging.layer(
      Schema.encodeUnknownSync(Initialized)(new Initialized())
    )
  ],
  scoped: Effect.gen(function*() {
    const { events, postMessage } = yield* WebviewMessaging.WebviewMessaging

    const currentTraceId = yield* SubscriptionRef.make(Option.none<string>())
    const selectedSpanId = yield* SubscriptionRef.make(Option.none<SpanId>())
    const expandedSpanIds = yield* SubscriptionRef.make(
      HashSet.empty<SpanId>()
    )

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
    return Stream.succeed(
      Option.none<[bigint, bigint]>()
    ).pipe(
      Stream.merge(
        tracerApp.ofType(UsedRangeInfo).pipe(Stream.map((_) => Option.some([_.startTime, _.endTime] as const)))
      ),
      Stream.onStart(tracerApp.request(new UsedRangeRequest()))
    )
  }).pipe(Stream.unwrap)
)

export const userRangeDefaultEmpty = tracerRuntime.atom((get) =>
  Effect.gen(function*() {
    const usedRange = yield* get.result(usedRangeAtom)
    return usedRange.pipe(
      Option.getOrElse(() => [BigInt(1), BigInt(-1)] as const)
    )
  })
)

export const userRangeAtom = Atom.make(Option.none<readonly [bigint, bigint]>())

export const viewRangeAtom = tracerRuntime.atom((get) =>
  Effect.gen(function*() {
    const userRange = get(userRangeAtom)
    const usedRange = yield* get.result(usedRangeAtom)
    return userRange.pipe(
      Option.orElse(() => usedRange),
      Option.getOrElse(() => [BigInt(1), BigInt(-1)] as const)
    )
  })
)

export const refreshApp = tracerRuntime.fn((_: any, ctx) =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    yield* tracerApp.request(new TraceListRequest())
    ctx.refresh(currentSpanIdsAtom)
    ctx.refresh(usedRangeAtom)
    ctx.refresh(minimapDataAtom)
    ctx.set(userRangeAtom, Option.none())
  })
)

export const currentSpanIdsAtom: Atom.Atom<
  Result.Result<ReadonlyArray<SpanId>, never>
> = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return Stream.zipLatestWith(
      tracerApp.currentTraceId.changes,
      tracerApp.expandedSpanIds.changes,
      (traceId, expandedSpanIds) => ({ traceId, expandedSpanIds })
    ).pipe(
      Stream.flatMap(
        ({ expandedSpanIds, traceId }) =>
          Stream.empty.pipe(
            Stream.merge(tracerApp.ofType(SpanListInfo)),
            Stream.filter((_) => Equal.equals(traceId, _.traceId)),
            Stream.map((_) => _.spanIds),
            Stream.onStart(
              tracerApp.request(
                new SpanListRequest({
                  traceId,
                  expandedSpanIds,
                  timeRange: Option.none()
                })
              )
            )
          ),
        { switch: true }
      ),
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
        Stream.onStart(
          tracerApp.request(new SpanDataForListRequest({ spanId }))
        )
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

export const setSelectedSpanIdAtom = tracerRuntime.fn(
  (e: CustomEvent<Array<VscodeTreeItem>>) =>
    Effect.gen(function*() {
      const tracerApp = yield* TracerApp
      if (e.detail.length > 0) {
        const spanId = e.detail[0].getAttribute("data-span-id")
        const traceId = e.detail[0].getAttribute("data-trace-id")
        if (spanId && traceId) {
          return yield* SubscriptionRef.set(
            tracerApp.selectedSpanId,
            Option.some(new SpanId({ traceId, spanId }))
          )
        }
      }
      return yield* SubscriptionRef.set(
        tracerApp.selectedSpanId,
        Option.none<SpanId>()
      )
    })
)

export const selectedSpanDetailsAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return tracerApp.selectedSpanId.changes.pipe(
      Stream.flatMap(
        Option.match({
          onSome: (spanId) =>
            tracerApp.ofType(SpanDataForDetailsInfo).pipe(
              Stream.filter((_) => Equal.equals(_.spanId, spanId)),
              Stream.map((_) => Option.some(_)),
              Stream.onStart(
                tracerApp.request(new SpanDataForDetailsRequest({ spanId }))
              )
            ),
          onNone: () => Stream.succeed(Option.none<SpanDataForDetailsInfo>())
        }),
        { switch: true }
      )
    )
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

export const minimapDataAtom = tracerRuntime.atom(() =>
  Effect.gen(function*() {
    const tracerApp = yield* TracerApp
    return Stream.succeed(
      new MinimapDataInfo({ traceId: Option.none(), bars: [] })
    ).pipe(
      Stream.merge(tracerApp.ofType(MinimapDataInfo)),
      Stream.onStart(
        tracerApp.request(new MinimapDataRequest({ traceId: Option.none() }))
      )
    )
  }).pipe(Stream.unwrap)
)

export interface ViewState {
  startTime: bigint
  endTime: bigint
}
