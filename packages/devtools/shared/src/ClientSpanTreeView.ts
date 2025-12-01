import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Data from "effect/Data"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Inspectable from "effect/Inspectable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as Clients from "./DevtoolClients.ts"
import * as Commands from "./DevtoolCommands.ts"
import * as DurationUtils from "./utils/Duration.ts"

class SpanNode extends Data.TaggedClass("SpanNode")<{
  path: Array<string>
  span: Domain.ParentSpan
  events: EventsNode
  childrenSpanIds: Array<string>
}> {
  get label() {
    return this.span._tag === "Span" ? this.span.name : "External Span"
  }

  get attributes() {
    return this.span._tag === "Span" ? this.span.attributes : new Map()
  }

  get isRoot() {
    if (this.span._tag === "ExternalSpan") {
      return true
    }
    return this.span.parent._tag === "None"
  }

  get duration(): Option.Option<Duration.Duration> {
    if (this.span._tag === "ExternalSpan") {
      return Option.none()
    }
    if (this.span.status._tag === "Ended") {
      return Option.some(
        Duration.nanos(this.span.status.endTime - this.span.status.startTime)
      )
    }
    return Option.none()
  }

  addChild(spanId: string) {
    if (this.childrenSpanIds.includes(spanId)) {
      return
    }
    this.childrenSpanIds.unshift(spanId)
  }

  children(nodesMap: Map<string, SpanNode>): Effect.Effect<Option.Option<Array<TreeNode>>> {
    const nodes: Array<TreeNode> = [
      new InfoNode({
        path: [...this.path, "traceId"],
        label: "Trace ID",
        description: this.span.traceId
      }),
      new InfoNode({
        path: [...this.path, "spanId"],
        label: "Span ID",
        description: this.span.spanId
      })
    ]

    this.attributes.forEach((value, key) => {
      nodes.push(
        new InfoNode({
          path: [...this.path, "attributes", key],
          label: key,
          description: Inspectable.toStringUnknown(value)
        })
      )
    })

    if (this.events.hasEvents) {
      nodes.push(this.events)
    }

    if (this.childrenSpanIds.length > 0) {
      nodes.push(
        new ChildrenNode({
          path: [...this.path, "children"],
          childrenSpanIds: this.childrenSpanIds,
          nodesMap
        })
      )
    }

    return Effect.succeedSome(nodes)
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const duration = this.duration
    return Effect.succeed({
      id: this.path.join("/"),
      label: this.label,
      description: duration._tag === "Some" ? DurationUtils.format(duration.value) : "",
      collapsibleState: "collapsed" as const
    })
  }
}

class InfoNode extends Data.TaggedClass("InfoNode")<{
  path: Array<string>
  label: string
  description: string
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.path.join("/"),
      label: this.label,
      description: this.description,
      tooltip: this.description,
      collapsibleState: "none" as const
    })
  }
}

class EventsNode extends Data.TaggedClass("EventsNode")<{
  path: Array<string>
  events: Array<SpanEventNode>
}> {
  get hasEvents() {
    return this.events.length > 0
  }

  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedSome(this.events)
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.path.join("/"),
      label: `Events (${this.events.length})`,
      collapsibleState: "collapsed" as const
    })
  }
}

class SpanEventNode extends Data.TaggedClass("SpanEventNode")<{
  path: Array<string>
  span: Domain.ParentSpan
  event: Domain.SpanEvent
}> {
  get hasAttributes() {
    return Object.keys(this.event.attributes).length > 0
  }

  get duration(): Option.Option<Duration.Duration> {
    if (this.span._tag === "ExternalSpan") {
      return Option.none()
    }
    return Option.some(
      Duration.nanos(this.event.startTime - this.span.status.startTime)
    )
  }

  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    const attributes = Object.entries(this.event.attributes)
    if (attributes.length === 0) {
      return Effect.succeedNone
    }
    return Effect.succeedSome(
      attributes.map(
        ([key, value]) =>
          new InfoNode({
            path: [...this.path, "attributes", key],
            label: key,
            description: Inspectable.toStringUnknown(value)
          })
      )
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const duration = this.duration
    return Effect.succeed({
      id: this.path.join("/"),
      label: this.event.name,
      description: duration._tag === "Some" ? DurationUtils.format(duration.value) : "",
      collapsibleState: this.hasAttributes ? "collapsed" as const : "none" as const
    })
  }
}

class ChildrenNode extends Data.TaggedClass("ChildrenNode")<{
  path: Array<string>
  childrenSpanIds: Array<string>
  nodesMap: Map<string, SpanNode>
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedSome(
      this.childrenSpanIds.map((id) => this.nodesMap.get(id)!).filter(Boolean)
    )
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: this.path.join("/"),
      label: "Child spans",
      collapsibleState: "expanded" as const
    })
  }
}

type TreeNode = SpanNode | InfoNode | ChildrenNode | EventsNode | SpanEventNode

export const ClientSpanTree = ExtTreeView.make<TreeNode>()("effect-tracer", {
  title: "Tracer"
})

export const ClientSpanTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const appScope = yield* Effect.scope
  const clients = yield* Clients.DevtoolClients
  const rootNodesRef = yield* SubscriptionRef.make<Array<SpanNode>>([])
  const nodesMapRef = yield* SubscriptionRef.make<Map<string, SpanNode>>(new Map())

  const reset = Effect.gen(function*() {
    yield* SubscriptionRef.set(rootNodesRef, [])
    yield* SubscriptionRef.set(nodesMapRef, new Map())
  })

  function addNode(
    span: Domain.ParentSpan,
    rootNodes: Array<SpanNode>,
    nodesMap: Map<string, SpanNode>
  ): [node: SpanNode, parent: SpanNode | undefined, isUpgrade: boolean] {
    let node = nodesMap.get(span.spanId)
    let parent: SpanNode | undefined
    let isUpgrade = span._tag === "Span" && node?.span._tag === "ExternalSpan"
    const isStartAfterEnd = node && node.span._tag === "Span" && node.span.status._tag === "Ended" &&
      span._tag === "Span" &&
      span.status._tag === "Started"

    if (node === undefined || isUpgrade) {
      if (node?.isRoot) {
        rootNodes.splice(rootNodes.indexOf(node), 1)
      }

      node = new SpanNode({
        path: [span.traceId, span.spanId],
        span,
        events: new EventsNode({ path: [span.traceId, span.spanId, "events"], events: [] }),
        childrenSpanIds: []
      })
      nodesMap.set(span.spanId, node)

      if (node.isRoot) {
        rootNodes.unshift(node)
        isUpgrade = true
      }
    }
    if (span._tag === "Span") {
      // Update the existing node with the new span data
      if (!isStartAfterEnd) {
        node = new SpanNode({
          ...node,
          span
        })
        nodesMap.set(span.spanId, node)
      }
    }

    if (node.span._tag === "Span" && node.span.parent._tag === "Some") {
      const [parentNode, __, parentHasUpgrade] = addNode(node.span.parent.value, rootNodes, nodesMap)
      parentNode.addChild(node.span.spanId)
      parent = parentNode
      isUpgrade = parentHasUpgrade || isUpgrade
    }

    return [node, parent, isUpgrade]
  }

  const registerSpan = (
    span: Domain.Span,
    refresh: ExtTreeView.ExtTreeViewRefresh<TreeNode>
  ): Effect.Effect<void> =>
    Effect.gen(function*() {
      const rootNodes = yield* SubscriptionRef.get(rootNodesRef)
      const nodesMap = yield* SubscriptionRef.get(nodesMapRef)

      const [, parent, refreshRoot] = addNode(span, rootNodes, nodesMap)

      yield* SubscriptionRef.set(rootNodesRef, rootNodes)
      yield* SubscriptionRef.set(nodesMapRef, nodesMap)

      if (parent !== undefined && refreshRoot) {
        return yield* Effect.zipRight(
          refresh(Option.some([parent])),
          refresh(Option.none())
        )
      } else if (
        parent !== undefined &&
        parent.span._tag === "ExternalSpan"
      ) {
        return yield* refresh(Option.none())
      }
      return yield* refresh(parent ? Option.some([parent]) : Option.none())
    })

  const registerSpanEvent = (
    event: Domain.SpanEvent,
    refresh: ExtTreeView.ExtTreeViewRefresh<TreeNode>
  ): Effect.Effect<void> =>
    Effect.gen(function*() {
      const nodesMap = yield* SubscriptionRef.get(nodesMapRef)
      const span = nodesMap.get(event.spanId)
      if (span === undefined) {
        return
      }
      span.events.events.push(
        new SpanEventNode({ path: [...span.path, "events", event.name], span: span.span, event })
      )
      yield* SubscriptionRef.set(nodesMapRef, nodesMap)
      return yield* refresh(Option.some([span]))
    })

  const handleClient = (client: Clients.Client, refresh: ExtTreeView.ExtTreeViewRefresh<TreeNode>) =>
    Effect.flatMap(client.spans, (spans) =>
      spans.take.pipe(
        Effect.flatMap((data) => {
          switch (data._tag) {
            case "Span": {
              return registerSpan(data, refresh)
            }
            case "SpanEvent": {
              return registerSpanEvent(data, refresh)
            }
          }
        })
      )).pipe(
        Effect.forever,
        Effect.ignore,
        Effect.scoped
      )

  const treeViewProvider = ClientSpanTree.toLayer((refresh) =>
    Effect.gen(function*() {
      yield* clients.clients.changes.pipe(
        Stream.flatMap(
          Effect.forEach((client) => handleClient(client, refresh), { concurrency: "unbounded" }),
          { switch: true }
        ),
        Stream.runDrain,
        Effect.forkIn(appScope)
      )

      // refresh the tree view when root nodes change
      yield* rootNodesRef.changes.pipe(
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkIn(appScope)
      )

      return {
        treeItem: (element) => element.treeItem(),
        children: Option.match({
          onNone: () => SubscriptionRef.get(rootNodesRef).pipe(Effect.map(Option.some)),
          onSome: (node) =>
            SubscriptionRef.get(nodesMapRef).pipe(Effect.flatMap((nodesMapRef) => node.children(nodesMapRef)))
        })
      }
    })
  )

  const resetTracer = Commands.ResetTracer.toLayer(
    Effect.succeed(() => reset.pipe(Effect.ignoreLogged))
  )

  return ExtTreeView.treeViewNavigationAction(ClientSpanTree, Commands.ResetTracer).pipe(
    Layer.provideMerge(treeViewProvider),
    Layer.provideMerge(resetTracer)
  )
}))
