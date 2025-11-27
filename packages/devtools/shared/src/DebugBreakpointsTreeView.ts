import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtHost from "./core/ExtHost.ts"
import type * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as Commands from "./DevtoolCommands.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"
import * as Inputs from "./DevtoolInputs.ts"

class PauseOnDefectStatusNode extends Data.TaggedClass("PauseOnDefectStatusNode")<{
  pauseOnDefects: boolean
  threadId: number | undefined
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.gen(this, function*() {
      const command = yield* Commands.TogglePauseOnDefects.withArgs({ threadId: this.threadId })
      return {
        id: "pauseOnDefects",
        label: (this.pauseOnDefects ? "☑" : "☐") + " Pause debug on defects",
        collapsibleState: "none" as const,
        command
      }
    })
  }
}

class PauseValueToRevealNode extends Data.TaggedClass("PauseValueToRevealNode")<{
  label: string
  variable: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variable.children.pipe(
      Effect.map(
        Array.map((variableRef, i) =>
          new VariableNode({
            variable: variableRef,
            path: ["vars", this.label].concat([variableRef.name || String(i)])
          })
        )
      ),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.label,
      label: this.label + ":",
      description: this.variable.value || "",
      tooltip: this.variable.value,
      collapsibleState: this.variable.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

class VariableNode extends Data.TaggedClass("VariableNode")<{
  path: Array<string>
  variable: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variable.children.pipe(
      Effect.map(
        Array.map((variableRef, i) =>
          new VariableNode({ path: this.path.concat([variableRef.name || String(i)]), variable: variableRef })
        )
      ),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.path.join("/"),
      label: this.variable.name + ":",
      description: this.variable.value || "",
      tooltip: this.variable.value,
      collapsibleState: this.variable.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

type TreeNode = PauseOnDefectStatusNode | PauseValueToRevealNode | VariableNode

export const DebugBreakpointsTree = ExtTreeView.make<TreeNode>()("effect-debug-breakpoints", {
  title: "Effect Breakpoints",
  when: Inputs.inDebugMode
})

export const DebugBreakpointsTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const debug = yield* DevtoolDebugBridge.DevtoolDebugBridge
  const devtoolHost = yield* ExtHost.ExtHost

  // state
  const pauseOnDefectsNodeRef = yield* SubscriptionRef.make<Option.Option<PauseOnDefectStatusNode>>(Option.none())
  const pauseValueToRevealNodesRef = yield* SubscriptionRef.make<Array<PauseValueToRevealNode>>([])

  // capture
  const capturePauseStateRef = yield* ScopedRef.make<void>(() => void 0)
  const resetPauseState = ScopedRef.set(capturePauseStateRef, Effect.void)
  const capturePauseState = (session: DevtoolDebugBridge.Bridge, threadId?: number) =>
    ScopedRef.set(
      capturePauseStateRef,
      Effect.gen(function*() {
        const pauseState = yield* session.getAndUnsetPauseStateToReveal(threadId)
        if (Option.isSome(pauseState.location)) {
          const location = pauseState.location.value
          yield* devtoolHost.revealFileLineColumnRange(
            location.path,
            location.line,
            location.column,
            location.line,
            location.column
          )
        }
        const nodes = pauseState.values.map((_) => new PauseValueToRevealNode({ label: _.label, variable: _.value }))

        // set the nodes and the cleanup function
        yield* SubscriptionRef.set(pauseValueToRevealNodesRef, nodes)
        yield* Effect.addFinalizer(() => SubscriptionRef.set(pauseValueToRevealNodesRef, []))
      })
    )

  const capturePauseConfigRef = yield* ScopedRef.make<void>(() => void 0)
  const resetPauseConfig = ScopedRef.set(capturePauseConfigRef, Effect.void)
  const capturePauseConfig = (session: DevtoolDebugBridge.Bridge, threadId?: number) =>
    ScopedRef.set(
      capturePauseConfigRef,
      Effect.gen(function*() {
        const autoPauseConfig = yield* session.currentAutoPauseConfig(threadId)
        yield* SubscriptionRef.set(
          pauseOnDefectsNodeRef,
          Option.some(new PauseOnDefectStatusNode({ pauseOnDefects: autoPauseConfig.pauseOnDefects, threadId }))
        )
        yield* Effect.addFinalizer(() => SubscriptionRef.set(pauseOnDefectsNodeRef, Option.none()))
      })
    )

  const getVisibleNodes = Effect.gen(function*() {
    const pauseOnDefectsNode = yield* SubscriptionRef.get(pauseOnDefectsNodeRef)
    const pauseValueToRevealNodes = yield* SubscriptionRef.get(pauseValueToRevealNodesRef)
    const nodes: Array<TreeNode> = Option.isSome(pauseOnDefectsNode)
      ? [pauseOnDefectsNode.value]
      : []
    return nodes.concat(pauseValueToRevealNodes)
  })

  yield* debug.activeBridge.changes.pipe(
    Stream.flatMap(
      Option.match({
        onNone: () => Stream.fromEffect(resetPauseConfig.pipe(Effect.zipRight(resetPauseState))),
        onSome: (session) =>
          Stream.fromPubSub(session.events).pipe(
            Stream.mapEffect((event) =>
              Effect.gen(function*() {
                switch (event._tag) {
                  case "DebuggerThreadStopped": {
                    yield* capturePauseConfig(session, event.threadId)
                    return yield* capturePauseState(session, event.threadId)
                  }
                  case "DebuggerThreadContinued": {
                    return yield* resetPauseState
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

  const treeViewProvider = DebugBreakpointsTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when nodes change
      yield* pauseOnDefectsNodeRef.changes.pipe(
        Stream.merge(pauseValueToRevealNodesRef.changes),
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkScoped
      )

      return {
        treeItem: (element) => element.treeItem(),
        children: Option.match({
          onNone: () => getVisibleNodes.pipe(Effect.map(Option.some)),
          onSome: (node) => node.children()
        })
      }
    })
  )

  const togglePauseOnDefects = Commands.TogglePauseOnDefects.toLayer(Effect.gen(function*() {
    return (_args) =>
      Effect.gen(function*() {
        const pauseOnDefectsNode = yield* SubscriptionRef.get(pauseOnDefectsNodeRef)
        const threadId = Option.isSome(pauseOnDefectsNode) ? pauseOnDefectsNode.value.threadId : undefined

        const session = yield* SubscriptionRef.get(debug.activeBridge)
        if (Option.isSome(session)) {
          yield* session.value.togglePauseOnDefects(threadId)
          yield* capturePauseConfig(session.value, threadId)
        }
      })
  }))

  return treeViewProvider.pipe(
    Layer.provideMerge(togglePauseOnDefects)
  )
}))
