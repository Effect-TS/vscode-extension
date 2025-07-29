import { Rx } from "@effect-rx/rx-react"
import * as DevToolsDomain from "@effect/experimental/DevTools/Domain"
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

    function registerSpan(span: DevToolsDomain.ParentSpan) {
      return SubscriptionRef.update(traceEvents, (rootSpans) => {
        const withoutSpan = rootSpans.filter((_) => _.id !== span.spanId)
        const toKeep = withoutSpan.filter((_) =>
          span._tag === "ExternalSpan" ? true : _.startTime <= span.status.startTime
        )
        const upOne = withoutSpan.filter((root) =>
          span._tag === "ExternalSpan" ? false : root.startTime > span.status.startTime
        ).map((_, i) => ({ ..._, depth: toKeep.length + 1 + i }))
        const now = BigInt(Date.now()) * 1_000_000n
        const currentEvent: TraceEvent = {
          id: span.spanId,
          name: span._tag === "ExternalSpan" ? "<external>" : span.name,
          startTime: span._tag === "Span" ? span.status.startTime : now,
          endTime: span._tag === "Span" && span.status._tag === "Ended" ? span.status.endTime : now,
          color: span._tag === "ExternalSpan" ? "#8e44ad" : span.status._tag === "Started" ? "#95a5a6" : "#2980b9",
          depth: toKeep.length
        }

        return [...toKeep, currentEvent, ...upOne]
      })
    }

    yield* vscode.messages.take.pipe(
      Effect.tap((message) => {
        switch (message._tag) {
          case "Span": {
            return registerSpan(message)
          }
        }
      }),
      Effect.forever,
      Effect.onExit(Effect.log),
      Effect.forkScoped
    )

    return { traceEvents, timeOrigin } as const
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
