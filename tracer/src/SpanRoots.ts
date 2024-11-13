import * as Effect from "effect/Effect"
import { VscodeWebview } from "./VsCode"
import * as DevToolsDomain from "@effect/experimental/DevTools/Domain"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { Span } from "./SpanRoots/Span"
import { pipe } from "effect/Function"
import * as Array from "effect/Array"
import * as Option from "effect/Option"
import { Rx } from "@effect-rx/rx-react"

export class SpanRoots extends Effect.Service<SpanRoots>()("SpanRoots", {
  accessors: true,
  scoped: Effect.gen(function* () {
    const vscode = yield* VscodeWebview

    const rootSpans = yield* SubscriptionRef.make<ReadonlyArray<Span>>([])

    function registerSpan(span: DevToolsDomain.ParentSpan) {
      return SubscriptionRef.update(rootSpans, rootSpans =>
        pipe(
          rootSpans,
          Array.findFirstIndex(root => root.traceId === span.traceId),
          Option.flatMap(index =>
            Array.modifyOption(rootSpans, index, root => root.addSpan(span)),
          ),
          Option.getOrElse(() => Array.prepend(rootSpans, Span.fromSpan(span))),
        ),
      )
    }

    function registerSpanEvent(event: DevToolsDomain.SpanEvent) {
      return SubscriptionRef.updateSome(rootSpans, rootSpans =>
        pipe(
          rootSpans,
          Array.findFirstIndex(root => root.traceId === event.traceId),
          Option.flatMap(index =>
            Array.modifyOption(rootSpans, index, root => root.addEvent(event)),
          ),
        ),
      )
    }

    yield* vscode.messages.take.pipe(
      Effect.tap(message => {
        switch (message._tag) {
          case "Span": {
            return registerSpan(message)
          }
          case "SpanEvent": {
            return registerSpanEvent(message)
          }
        }
      }),
      Effect.forever,
      Effect.onExit(Effect.log),
      Effect.forkScoped,
    )

    return { rootSpans } as const
  }),
  dependencies: [VscodeWebview.Default],
}) {}

// rx

const runtime = Rx.runtime(SpanRoots.Default).pipe(Rx.keepAlive)

export const selectedSpanRx = Rx.make(0)

export const spanRootsInternal = runtime.subscribable(
  Effect.map(SpanRoots, service => service.rootSpans),
)

export const spanRootsRx = Rx.make(get => {
  get.subscribe(spanRootsInternal, roots => {
    get.setSelfSync(roots)
    get.setSync(selectedSpanRx, 0)
  })
  return get.once(spanRootsInternal)
})
