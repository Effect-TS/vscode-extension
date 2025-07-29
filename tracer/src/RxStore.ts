import { Rx } from "@effect-rx/rx-react"
import * as DevToolsDomain from "@effect/experimental/DevTools/Domain"
import { Clock } from "effect"
import * as Effect from "effect/Effect"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { TraceEvent } from "./components/TraceViewerUtils"
import { VscodeWebview } from "./VscodeWebview"

export class RxStore extends Effect.Service<RxStore>()("RxStore", {
  accessors: true,
  scoped: Effect.gen(function*() {
    const vscode = yield* VscodeWebview

    const traceEvents = yield* SubscriptionRef.make<ReadonlyArray<TraceEvent>>([])
    const timeOrigin = yield* SubscriptionRef.make<bigint>(BigInt(Date.now()) * 1_000_000n)
    const expandedSpanIds = yield* SubscriptionRef.make<ReadonlyArray<string>>(["<root>"])

    const spanById = new Map<string, DevToolsDomain.ParentSpan>()
    const spanIdsByParentId = new Map<string, Set<string>>()

    function layoutTraceEvents(now: bigint, expandedSpanIds: ReadonlyArray<string>) {
      const toProcess: Array<string> = ["<root>"]
      const layoutedEvents: Array<TraceEvent> = []
      const parentDepth = new Map<string, number>()
      let currentDepth = 0
      while (toProcess.length > 0) {
        const spanId = toProcess.shift()
        if (!spanId) break

        // ensure we layout all children before we layout the parent (just save the depth for the parent)
        const childIds = spanIdsByParentId.get(spanId)
        const forcedDepth = parentDepth.get(spanId)
        if (childIds && expandedSpanIds.includes(spanId) && forcedDepth === undefined) {
          toProcess.unshift(...childIds, spanId)
          parentDepth.set(spanId, currentDepth++)
          continue
        }

        // layout the span
        const span = spanById.get(spanId)
        const name = span ? span._tag === "ExternalSpan" ? "<external>" : span.name : "<" + spanId + ">"
        const expandCollapseChevron = childIds && expandedSpanIds.includes(spanId) ? "⌄ " : childIds ? "› " : ""
        layoutedEvents.push({
          id: spanId,
          name: expandCollapseChevron + name,
          startTime: span && span._tag === "Span" ? span.status.startTime : now,
          endTime: span && span._tag === "Span" && span.status._tag === "Ended" ? span.status.endTime : now,
          color: span
            ? span._tag === "ExternalSpan" ? "#8e44ad" : span.status._tag === "Started" ? "#95a5a6" : "#2980b9"
            : "#000000",
          depth: (forcedDepth || currentDepth++) - 1
        })
      }
      return layoutedEvents
    }

    const layoutNow = Effect.gen(function*() {
      const now = yield* Clock.currentTimeNanos
      const currentExpandedSpanIds = yield* SubscriptionRef.get(expandedSpanIds)
      return yield* SubscriptionRef.update(traceEvents, () => layoutTraceEvents(now, currentExpandedSpanIds))
    })

    const reset = SubscriptionRef.set(traceEvents, []).pipe(
      Effect.andThen(() => SubscriptionRef.set(timeOrigin, BigInt(Date.now()) * 1_000_000n)),
      Effect.andThen(() => SubscriptionRef.set(expandedSpanIds, ["<root>"] as const)),
      Effect.andThen(() =>
        Effect.sync(() => {
          spanById.clear()
          spanIdsByParentId.clear()
        })
      )
    )
    yield* reset

    function toggleSpanExpanded(spanId: string) {
      return SubscriptionRef.update(expandedSpanIds, (expandedSpanIds) => {
        const newExpandedSpanIds = expandedSpanIds.includes(spanId)
          ? expandedSpanIds.filter((id) => id !== spanId)
          : [...expandedSpanIds, spanId]
        return newExpandedSpanIds
      }).pipe(Effect.andThen(layoutNow))
    }

    function registerSpan(span: DevToolsDomain.ParentSpan) {
      let currentSpan: DevToolsDomain.ParentSpan | undefined = span
      while (currentSpan) {
        if (!spanById.has(currentSpan.spanId)) spanById.set(currentSpan.spanId, currentSpan)
        const parentId = currentSpan._tag === "Span" && currentSpan.parent._tag === "Some"
          ? currentSpan.parent.value.spanId
          : "<root>"
        const parentSet = spanIdsByParentId.get(parentId) ?? new Set<string>()
        parentSet.add(currentSpan.spanId)
        spanIdsByParentId.set(parentId, parentSet)

        currentSpan = currentSpan._tag === "Span" && currentSpan.parent._tag === "Some"
          ? currentSpan.parent.value
          : undefined
      }
      spanById.set(span.spanId, span)

      return layoutNow
    }

    yield* vscode.messages.take.pipe(
      Effect.tap((message) => {
        switch (message._tag) {
          case "Span": {
            return registerSpan(message)
          }
          case "ResetTracer": {
            return reset
          }
        }
      }),
      Effect.forever,
      Effect.onExit(Effect.log),
      Effect.forkScoped
    )

    return { traceEvents, timeOrigin, toggleSpanExpanded } as const
  }),
  dependencies: [VscodeWebview.Default]
}) {}

// rx

const runtime = Rx.runtime(RxStore.Default).pipe(Rx.keepAlive)

export const traceEventsInternal = runtime.subscribable(
  Effect.map(RxStore, (service) => service.traceEvents)
)

export const traceEventsRx = Rx.make((get) => {
  get.subscribe(traceEventsInternal, (roots) => {
    get.setSelf(roots)
  })
  return get.once(traceEventsInternal)
})

export const timeOriginRx = runtime.subscribable(Effect.map(RxStore, (service) => service.timeOrigin))

export const toggleSpanExpandedRx = runtime.fn((spanId: string) =>
  Effect.flatMap(RxStore, (service) => service.toggleSpanExpanded(spanId))
)
