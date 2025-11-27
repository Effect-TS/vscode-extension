import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { minimatch } from "minimatch"
import * as ExtHost from "./core/ExtHost.ts"
import type * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import * as ExtIcon from "./core/ExtIcon.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as Configs from "./DevtoolConfigs.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"
import * as Inputs from "./DevtoolInputs.ts"

class SpanNode extends Data.TaggedClass("SpanNode")<{
  spanId: string
  traceId: string
  stackIdx: number
  span: DevtoolDebugBridge.SpanStackEntry
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    if (this.span.attributes.length > 0) {
      return Effect.succeedSome(
        Array.map(this.span.attributes, ([name, variable]) => new AttributeNode({ span: this.span, name, variable }))
      )
    }
    return Effect.succeedNone
  }

  treeItem(workspaceAsRelativePath: (uri: any) => string): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const description = this.span.path
      ? workspaceAsRelativePath(this.span.path) + ":" + (this.span.line + 1) + ":" + (this.span.column + 1)
      : undefined

    return Effect.succeed({
      id: [this.traceId, this.spanId, this.stackIdx].join("/"),
      label: this.span.name,
      description: description || "",
      tooltip: this.span.spanId,
      icon: this.span.stackIndex >= 1 ? ExtIcon.indent : undefined,
      collapsibleState: this.span.attributes.length > 0 ? "collapsed" as const : "none" as const
    })
  }

  currentSpanLocation() {
    if (this.span && this.span.path) {
      return {
        path: this.span.path,
        line: this.span.line,
        column: this.span.column
      }
    }
    return undefined
  }
}

class AttributeNode extends Data.TaggedClass("AttributeNode")<{
  span: DevtoolDebugBridge.SpanStackEntry
  name: string
  variable: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variable.children.pipe(
      Effect.map(
        Array.map((variableRef) =>
          new VariableNode({ span: this.span, attributeName: this.name, path: [], variable: variableRef })
        )
      ),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: [this.span.traceId, this.span.spanId, this.span.stackIndex, this.name].join("/"),
      label: this.name + ":",
      description: this.variable.value || "",
      tooltip: this.variable.value,
      collapsibleState: this.variable.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

class VariableNode extends Data.TaggedClass("VariableNode")<{
  span: DevtoolDebugBridge.SpanStackEntry
  attributeName: string
  path: Array<string>
  variable: ExtHostDebuggerConnection.VariableReference
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return this.variable.children.pipe(
      Effect.map(
        Array.map((variableRef, i) =>
          new VariableNode({
            span: this.span,
            variable: variableRef,
            attributeName: this.attributeName,
            path: this.path.concat([variableRef.name || String(i)])
          })
        )
      ),
      Effect.map(Option.some),
      Effect.orElseSucceed(() => Option.none())
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: [this.span.traceId, this.span.spanId, this.span.stackIndex, this.attributeName, ...this.path].join("/"),
      label: this.variable.name + ":",
      description: this.variable.value || "",
      tooltip: this.variable.value,
      collapsibleState: this.variable.isContainer ? "collapsed" as const : "none" as const
    })
  }
}

class IgnoredNode extends Data.TaggedClass("IgnoredNode")<{
  index: number
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: "ignored-" + this.index,
      label: "",
      description: "...ignored...",
      collapsibleState: "none" as const
    })
  }
}

type TreeNode = SpanNode | AttributeNode | VariableNode | IgnoredNode

export const DebugSpanStackTree = ExtTreeView.make<TreeNode>()("effect-debug-span-stack", {
  title: "Effect Span Stack",
  when: Inputs.inDebugMode
})

export const DebugSpanStackTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const debug = yield* DevtoolDebugBridge.DevtoolDebugBridge
  // state
  const nodesRef = yield* SubscriptionRef.make<Array<SpanNode>>([])
  const spanStackIgnoreListEnabled = yield* Inputs.spanStackIgnoreListEnabled

  // capture
  const captureSpanStackRef = yield* ScopedRef.make<void>(() => void 0)
  const resetSpanStack = ScopedRef.set(captureSpanStackRef, Effect.void)
  const captureSpanStack = (session: DevtoolDebugBridge.Bridge, threadId?: number) =>
    ScopedRef.set(
      captureSpanStackRef,
      Effect.gen(function*() {
        const spans = yield* session.currentSpanStack(threadId)
        const spanNodes = spans.map((span) =>
          new SpanNode({ span, spanId: span.spanId, traceId: span.traceId, stackIdx: span.stackIndex })
        )
        yield* SubscriptionRef.set(nodesRef, spanNodes).pipe(
          Effect.delay(500)
        )
        yield* Effect.addFinalizer(() => SubscriptionRef.set(nodesRef, []))
      })
    )

  // refresh
  const refreshSignalRef = yield* SubscriptionRef.make(0)
  const refreshSpanStackCommand = DevtoolCommands.RefreshDebugSpanStack.toLayer(Effect.gen(function*() {
    return () => SubscriptionRef.update(refreshSignalRef, (_) => _ + 1)
  }))

  // handle ignore list, so user can filter out spans that match the patterns
  const ignoreList = yield* Configs.SpanStackIgnoreList
  const ignoreListEnabledRef = yield* SubscriptionRef.make(true)

  const setIgnoreListEnabled = (enabled: boolean) =>
    Effect.zipRight(
      SubscriptionRef.set(ignoreListEnabledRef, enabled),
      spanStackIgnoreListEnabled(enabled)
    )

  yield* setIgnoreListEnabled(true)

  const getVisibleNodes = Effect.gen(function*() {
    const nodes = yield* SubscriptionRef.get(nodesRef)
    const ignoreListValue = yield* ignoreList.get
    const ignoreListEnabled = yield* SubscriptionRef.get(ignoreListEnabledRef)

    if (!ignoreListEnabled || ignoreListValue.length === 0) {
      return nodes
    }

    const result: Array<TreeNode> = []
    for (const node of nodes) {
      const isIgnored = ignoreListValue.some((pattern) => minimatch(node.span.name, pattern))
      if (isIgnored) {
        if (result.length === 0 || result[result.length - 1]._tag !== "IgnoredNode") {
          result.push(new IgnoredNode({ index: result.length }))
        }
      } else {
        result.push(node)
      }
    }
    return result
  })

  // capture the span stack when the thread stops or continues
  yield* debug.activeBridge.changes.pipe(
    Stream.flatMap(
      Option.match({
        onNone: () => Stream.fromEffect(resetSpanStack),
        onSome: (session) =>
          Stream.zipLatestAll(Stream.fromPubSub(session.events), refreshSignalRef.changes).pipe(
            Stream.mapEffect(([event]) =>
              Effect.gen(function*() {
                switch (event._tag) {
                  case "DebuggerThreadStopped": {
                    return yield* captureSpanStack(session, event.threadId)
                  }
                  case "DebuggerThreadContinued": {
                    return yield* resetSpanStack
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

  const treeViewProvider = DebugSpanStackTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when nodes, ignore list, or ignore list enabled changes
      yield* nodesRef.changes.pipe(
        Stream.merge(
          ignoreList.changes
        ),
        Stream.merge(ignoreListEnabledRef.changes),
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkScoped
      )

      // Import workspace API for relative path calculation
      const devtoolHost = yield* ExtHost.ExtHost
      const workspaceAsRelativePath = (uri: any) => devtoolHost.asWorkspaceRelativePath(uri)

      return {
        treeItem: (element) => element.treeItem(workspaceAsRelativePath),
        children: Option.match({
          onNone: () => getVisibleNodes.pipe(Effect.map(Option.some)),
          onSome: (node: TreeNode) => node.children()
        })
      }
    })
  )

  const enableSpanStackIgnoreList = DevtoolCommands.EnableSpanStackIgnoreList.toLayer(
    Effect.succeed(() => setIgnoreListEnabled(true))
  )

  const disableSpanStackIgnoreList = DevtoolCommands.DisableSpanStackIgnoreList.toLayer(
    Effect.succeed(() => setIgnoreListEnabled(false))
  )

  const revealSpanLocation = DevtoolCommands.RevealSpanLocation.toLayer(Effect.gen(function*() {
    const devtoolHost = yield* ExtHost.ExtHost
    return (args) =>
      Effect.gen(function*() {
        const nodes = yield* SubscriptionRef.get(nodesRef)
        const spanNode = yield* Array.findFirst(nodes, (_) =>
          _.spanId === args.spanId && _.traceId === args.traceId && _.stackIdx === args.stackIdx)
        const spanLocation = spanNode.currentSpanLocation()
        if (spanLocation) {
          yield* devtoolHost.revealFileLineColumnRange(
            spanLocation.path,
            spanLocation.line,
            spanLocation.column,
            spanLocation.line,
            spanLocation.column
          )
        }
      }).pipe(Effect.ignoreLogged)
  }))

  return treeViewProvider.pipe(
    Layer.provideMerge(enableSpanStackIgnoreList),
    Layer.provideMerge(disableSpanStackIgnoreList),
    Layer.provideMerge(revealSpanLocation),
    Layer.provideMerge(refreshSpanStackCommand)
  )
}))
