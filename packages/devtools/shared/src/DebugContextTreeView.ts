import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"
import * as Inputs from "./DevtoolInputs.ts"

class TagNode extends Data.TaggedClass("TagNode")<{
  pair: DevtoolDebugBridge.ContextPair
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.pair.service.children.pipe(
      Effect.map(Array.map((variableRef, i) =>
        new VariableNode({
          path: [this.pair.tag].concat([variableRef.name || String(i)]),
          variable: variableRef
        })
      )),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.pair.tag,
      label: this.pair.tag + ":",
      description: this.pair.service.value || "",
      tooltip: this.pair.service.value,
      collapsibleState: "collapsed" as const
    })
  }
}

class VariableNode extends Data.TaggedClass("VariableNode")<{
  path: Array<string>
  variable: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variable.children.pipe(
      Effect.map(Array.map((variableRef, i) =>
        new VariableNode({
          path: this.path.concat([variableRef.name || String(i)]),
          variable: variableRef
        })
      )),
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

type TreeNode = TagNode | VariableNode

export const DebugContextTree = ExtTreeView.make<TreeNode>()("effect-context", {
  title: "Effect Context",
  when: Inputs.inDebugMode
})

export const DebugContextTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const debug = yield* DevtoolDebugBridge.DevtoolDebugBridge

  // state
  const nodesRef = yield* SubscriptionRef.make<Array<TagNode>>([])

  // capture
  const captureContextRef = yield* ScopedRef.make<void>(() => void 0)
  const resetContext = ScopedRef.set(captureContextRef, Effect.void)
  const captureContext = (session: DevtoolDebugBridge.Bridge, threadId?: number) =>
    ScopedRef.set(
      captureContextRef,
      Effect.gen(function*() {
        const pairs = yield* session.context(threadId)
        const tagNodes = pairs.map((pair) => new TagNode({ pair }))
        yield* SubscriptionRef.set(nodesRef, tagNodes)
        yield* Effect.addFinalizer(() => SubscriptionRef.set(nodesRef, []))
      })
    )

  const refreshSignalRef = yield* SubscriptionRef.make(0)
  const refreshContextCommand = DevtoolCommands.RefreshDebugContext.toLayer(Effect.gen(function*() {
    return () => SubscriptionRef.update(refreshSignalRef, (_) => _ + 1)
  }))

  // capture the context when the thread stops or continues
  yield* debug.activeBridge.changes.pipe(
    Stream.flatMap(
      Option.match({
        onNone: () => Stream.fromEffect(resetContext),
        onSome: (session) =>
          Stream.zipLatestAll(Stream.fromPubSub(session.events), refreshSignalRef.changes).pipe(
            Stream.mapEffect(([event]) =>
              Effect.gen(function*() {
                switch (event._tag) {
                  case "DebuggerThreadStopped": {
                    return yield* captureContext(session, event.threadId)
                  }
                  case "DebuggerThreadContinued": {
                    return yield* resetContext
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

  const treeViewProvider = DebugContextTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when the nodes change
      yield* nodesRef.changes.pipe(
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkScoped
      )

      return {
        treeItem: (element) => element.treeItem(),
        children: Option.match({
          onNone: () => SubscriptionRef.get(nodesRef).pipe(Effect.map(Option.some)),
          onSome: (node) => node.children()
        })
      }
    })
  )

  return treeViewProvider.pipe(
    Layer.provideMerge(refreshContextCommand)
  )
}))
