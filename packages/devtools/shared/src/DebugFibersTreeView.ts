import { pipe } from "effect"
import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtHost from "./core/ExtHost.ts"
import type * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import * as ExtIcon from "./core/ExtIcon.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"
import * as Inputs from "./DevtoolInputs.ts"
import * as DurationUtils from "./utils/Duration.ts"

const SortByStartTimeMillis = Order.mapInput(Order.number, (a: DevtoolDebugBridge.FiberEntry) => a.startTimeMillis)

class FiberId extends Data.TaggedClass("FiberId")<{
  fiberId: string
  fiberEntry: DevtoolDebugBridge.FiberEntry
  threadId: number | undefined
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    const attributes = pipe(
      this.fiberEntry.currentSpan,
      Option.filter((_) => _._tag === "Span"),
      Option.map((_) =>
        _.attributes.map(([attributeName, variableRef]) =>
          new FiberAttribute({
            fiberEntry: this.fiberEntry,
            fiberId: this.fiberId,
            traceId: _.traceId,
            spanId: _.spanId,
            attributeName,
            variableRef
          })
        )
      ),
      Option.getOrElse(() => [])
    )
    return Effect.succeedSome([
      new FiberMetadata({
        fiberEntry: this.fiberEntry,
        fiberId: this.fiberId,
        metadataName: "startTimeMillis"
      }),
      new FiberMetadata({
        fiberEntry: this.fiberEntry,
        fiberId: this.fiberId,
        metadataName: "lifeTimeMillis"
      }),
      new FiberMetadata({
        fiberEntry: this.fiberEntry,
        fiberId: this.fiberId,
        metadataName: "interruptible"
      }),
      new FiberMetadata({
        fiberEntry: this.fiberEntry,
        fiberId: this.fiberId,
        metadataName: "interrupted"
      }),
      ...attributes
    ])
  }

  treeItem(pendingInterruptions: Array<string>): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const interruptionRequested = pendingInterruptions.includes(this.fiberId)
    const description = pipe(
      this.fiberEntry.currentSpan,
      Option.filter((_) => _._tag === "Span"),
      Option.map((_) => _.name),
      Option.getOrElse(() => "")
    )
    return Effect.succeed({
      id: this.fiberId,
      label: "#" + this.fiberEntry.id + (this.fiberEntry.isInterrupted ? " (interrupting)" : "") +
        (this.fiberEntry.isInterruptible ? "" : " (uninterruptible)") +
        (interruptionRequested ? " (interruption requested)" : ""),
      description,
      icon: this.fiberEntry.isCurrent ? ExtIcon.circleFilled : ExtIcon.circle,
      collapsibleState: "collapsed" as const
    })
  }

  currentSpanLocation() {
    return pipe(
      this.fiberEntry.currentSpan,
      Option.filter((_) => _._tag === "Span"),
      Option.flatMap((_) => Array.head(_.stack)),
      Option.getOrUndefined
    )
  }
}

class FiberMetadata extends Data.TaggedClass("FiberMetadata")<{
  fiberEntry: DevtoolDebugBridge.FiberEntry
  fiberId: string
  metadataName: "startTimeMillis" | "lifeTimeMillis" | "interruptible" | "interrupted"
}> {
  children() {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    let description: string = ""
    let label: string = ""
    switch (this.metadataName) {
      case "startTimeMillis": {
        label = "Started At"
        description = DateTime.make(this.fiberEntry.startTimeMillis).pipe(
          Option.map(
            DateTime.formatLocal({ dateStyle: "medium", timeStyle: "long" })
          ),
          Option.getOrElse(() => String(this.fiberEntry.startTimeMillis))
        )
        break
      }
      case "lifeTimeMillis": {
        label = "Lifetime"
        description = DurationUtils.format(Duration.millis(this.fiberEntry.lifeTimeMillis))
        break
      }
      case "interruptible": {
        label = "Interruptible"
        description = this.fiberEntry.isInterruptible ? "true" : "false"
        break
      }
      case "interrupted": {
        label = "Interrupted"
        description = this.fiberEntry.isInterrupted ? "true" : "false"
        break
      }
    }

    return Effect.succeed({
      id: [this.fiberId, this.metadataName].join("/"),
      label,
      description,
      collapsibleState: "none" as const
    })
  }
}

class FiberAttribute extends Data.TaggedClass("FiberAttribute")<{
  fiberId: string
  fiberEntry: DevtoolDebugBridge.FiberEntry
  traceId: string
  spanId: string
  attributeName: string
  variableRef: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variableRef.children.pipe(
      Effect.map(Array.map((_, i) =>
        new FiberAttributeVariable({
          fiberEntry: this.fiberEntry,
          fiberId: this.fiberId,
          traceId: this.traceId,
          spanId: this.spanId,
          attributeName: this.attributeName,
          path: [_.name || String(i)],
          variableRef: _
        })
      )),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: [this.fiberId, this.traceId, this.spanId, this.attributeName].join("/"),
      label: this.attributeName,
      description: this.variableRef.value || "",
      collapsibleState: this.variableRef.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

class FiberAttributeVariable extends Data.TaggedClass("FiberAttributeVariable")<{
  fiberId: string
  fiberEntry: DevtoolDebugBridge.FiberEntry
  traceId: string
  spanId: string
  attributeName: string
  path: Array<string>
  variableRef: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variableRef.children.pipe(
      Effect.map(Array.map((_, i) =>
        new FiberAttributeVariable({
          fiberId: this.fiberId,
          fiberEntry: this.fiberEntry,
          traceId: this.traceId,
          spanId: this.spanId,
          attributeName: this.attributeName,
          path: this.path.concat([_.name || String(i)]),
          variableRef: _
        })
      )),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: [this.fiberId, this.traceId, this.spanId, this.attributeName, ...this.path].join("/"),
      label: this.variableRef.name || "",
      description: this.variableRef.value || "",
      collapsibleState: this.variableRef.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

type TreeNode = FiberId | FiberMetadata | FiberAttribute | FiberAttributeVariable

export const DebugFibersTree = ExtTreeView.make<TreeNode>()("effect-debug-fibers", {
  title: "Effect Fibers",
  when: Inputs.inDebugMode
})

export const DebugFibersTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const debugBridge = yield* DevtoolDebugBridge.DevtoolDebugBridge

  // state
  const fibersRef = yield* SubscriptionRef.make<Array<FiberId>>([])
  const pendingInterruptionsRef = yield* SubscriptionRef.make<Array<string>>([])

  // capture the fibers
  const captureFibersRef = yield* ScopedRef.make<void>(() => void 0)
  const resetFibers = ScopedRef.set(captureFibersRef, Effect.void)
  const captureFibers = (session: DevtoolDebugBridge.Bridge, threadId?: number) =>
    ScopedRef.set(
      captureFibersRef,
      Effect.gen(function*() {
        const fiberNodes = pipe(
          yield* session.currentFibers(threadId),
          Array.sort(SortByStartTimeMillis),
          Array.map((_) => new FiberId({ fiberId: _.id, threadId, fiberEntry: _ }))
        )
        yield* SubscriptionRef.set(fibersRef, fiberNodes)
        yield* Effect.addFinalizer(() => SubscriptionRef.set(fibersRef, []))
      })
    )

  // refresh
  const refreshSignalRef = yield* SubscriptionRef.make(0)
  const refreshFibersCommand = DevtoolCommands.DebugFibersRefresh.toLayer(Effect.gen(function*() {
    return () => SubscriptionRef.update(refreshSignalRef, (_) => _ + 1)
  }))

  // capture the fibers when the thread stops or continues
  yield* debugBridge.activeBridge.changes.pipe(
    Stream.flatMap(
      Option.match({
        onNone: () => Stream.fromEffect(resetFibers),
        onSome: (session) =>
          Stream.zipLatestAll(Stream.fromPubSub(session.events), refreshSignalRef.changes).pipe(
            Stream.mapEffect(([event]) =>
              Effect.gen(function*() {
                switch (event._tag) {
                  case "DebuggerThreadStopped": {
                    return yield* captureFibers(session, event.threadId)
                  }
                  case "DebuggerThreadContinued": {
                    return yield* resetFibers
                  }
                }
              }).pipe(Effect.ignoreLogged)
            )
          )
      }),
      { switch: true }
    ),
    Stream.runDrain,
    Effect.forkScoped
  )

  const treeViewProvider = DebugFibersTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when the fibers change
      yield* Stream.merge(fibersRef.changes, pendingInterruptionsRef.changes).pipe(
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkScoped
      )

      return {
        treeItem: (element) =>
          SubscriptionRef.get(pendingInterruptionsRef).pipe(
            Effect.flatMap((pendingInterruptions) => element.treeItem(pendingInterruptions))
          ),
        children: Option.match({
          onNone: () => SubscriptionRef.get(fibersRef).pipe(Effect.map(Option.some)),
          onSome: (node) => node.children()
        })
      }
    })
  )

  const revealFiberCurrentSpan = DevtoolCommands.RevealFiberCurrentSpan.toLayer(Effect.gen(function*() {
    const devtoolHost = yield* ExtHost.ExtHost
    return (args) =>
      Effect.gen(function*() {
        const fibers = yield* SubscriptionRef.get(fibersRef)
        const fiberEntry = yield* Array.findFirst(fibers, (_) => _.fiberId === args.fiberId)
        const stackEntry = fiberEntry.currentSpanLocation()
        if (stackEntry) {
          yield* devtoolHost.revealFileLineColumnRange(
            stackEntry.path,
            stackEntry.line,
            stackEntry.column,
            stackEntry.line,
            stackEntry.column
          )
        }
      }).pipe(Effect.ignoreLogged)
  }))

  const interruptFiber = DevtoolCommands.InterruptDebugFiber.toLayer(Effect.gen(function*() {
    return (args) =>
      Effect.gen(function*() {
        const activeBridge = yield* debugBridge.activeBridge.get
        if (Option.isSome(activeBridge)) {
          const fibers = yield* SubscriptionRef.get(fibersRef)
          const fiberEntry = Array.findFirst(fibers, (_) => _.fiberId === args.fiberId)
          if (Option.isSome(fiberEntry)) {
            yield* activeBridge.value.interruptFiber(fiberEntry.value.fiberId, fiberEntry.value.threadId)
            yield* SubscriptionRef.update(
              pendingInterruptionsRef,
              (pendingInterruptions) => [...pendingInterruptions, args.fiberId]
            )
          }
        }
      })
  }))

  return treeViewProvider.pipe(
    Layer.provideMerge(revealFiberCurrentSpan),
    Layer.provideMerge(interruptFiber),
    Layer.provideMerge(refreshFibersCommand)
  )
}))
