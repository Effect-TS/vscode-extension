import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as vscode from "vscode"
import { Client, Clients } from "./Clients"
import { TreeDataProvider, registerCommand, treeDataProvider } from "./VsCode"
import * as DurationUtils from "./utils/Duration"
import * as Inspectable from "effect/Inspectable"

class SpanNode {
  readonly _tag = "SpanNode"

  constructor(public span: Domain.ParentSpan) {}

  events: EventsNode = new EventsNode([])

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
        Duration.nanos(this.span.status.endTime - this.span.status.startTime),
      )
    }
    return Option.none()
  }

  private _children: Array<string> = []
  get children(): Array<string> {
    return this._children
  }

  addChild(spanId: string) {
    if (this._children.includes(spanId)) {
      return
    }
    this._children.unshift(spanId)
  }
}

export class InfoNode {
  readonly _tag = "InfoNode"
  constructor(
    readonly label: string,
    readonly description: string,
  ) {}
}

class EventsNode {
  readonly _tag = "EventsNode"
  constructor(readonly events: Array<SpanEventNode>) {}
  get hasEvents() {
    return this.events.length > 0
  }
}

class SpanEventNode {
  readonly _tag = "SpanEventNode"
  constructor(
    readonly span: Domain.ParentSpan,
    readonly event: Domain.SpanEvent,
  ) {}

  get hasAttributes() {
    return Object.keys(this.event.attributes).length > 0
  }

  get duration(): Option.Option<Duration.Duration> {
    if (this.span._tag === "ExternalSpan") {
      return Option.none()
    }
    return Option.some(
      Duration.nanos(this.event.startTime - this.span.status.startTime),
    )
  }
}

class ChildrenNode {
  readonly _tag = "ChildrenNode"
  constructor(readonly childrenSpanIds: Array<string>) {}
}

type TreeNode = SpanNode | InfoNode | ChildrenNode | EventsNode | SpanEventNode

export const SpanProviderLive = treeDataProvider<TreeNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* () {
      const clients = yield* Clients
      const rootNodes: Array<SpanNode> = []
      const nodes = new Map<string, SpanNode>()

      const reset = Effect.suspend(() => {
        rootNodes.length = 0
        nodes.clear()
        return refresh(Option.none())
      })
      yield* registerCommand("effect.resetTracer", () => reset)

      const handleClient = (client: Client) =>
        client.spans.take.pipe(
          Effect.flatMap(data => {
            switch (data._tag) {
              case "Span": {
                return registerSpan(data)
              }
              case "SpanEvent": {
                return registerSpanEvent(data)
              }
            }
          }),
          Effect.forever,
          Effect.ignore,
        )

      yield* clients.clients.changes.pipe(
        Stream.flatMap(
          Effect.forEach(handleClient, { concurrency: "unbounded" }),
          { switch: true },
        ),
        Stream.runDrain,
        Effect.forkScoped,
      )

      function addNode(
        span: Domain.ParentSpan,
      ): [SpanNode, SpanNode | undefined, boolean] {
        let node = nodes.get(span.spanId)
        let parent: SpanNode | undefined
        const isUpgrade =
          span._tag === "Span" && node?.span._tag === "ExternalSpan"

        if (node === undefined || isUpgrade) {
          if (node?.isRoot) {
            rootNodes.splice(rootNodes.indexOf(node), 1)
          }

          node = new SpanNode(span)
          nodes.set(span.spanId, node)

          if (node.isRoot) {
            rootNodes.unshift(node)
          }

          if (span._tag === "Span" && span.parent._tag === "Some") {
            parent = addNode(span.parent.value)[0]
            parent.addChild(span.spanId)
          }
        } else if (span._tag === "Span" && span.parent._tag === "Some") {
          parent = addNode(span.parent.value)[0]
        }

        if (span._tag === "Span") {
          node.span = span
        }

        return [node, parent, isUpgrade]
      }

      const registerSpan = (span: Domain.Span): Effect.Effect<void> =>
        Effect.suspend(() => {
          const [, parent, refreshRoot] = addNode(span)
          if (parent !== undefined && refreshRoot) {
            return Effect.zipRight(
              refresh(Option.some(parent)),
              refresh(Option.none()),
            )
          } else if (
            parent !== undefined &&
            parent.span._tag === "ExternalSpan"
          ) {
            return refresh(Option.none())
          }
          return refresh(Option.fromNullable(parent))
        })

      const registerSpanEvent = (
        event: Domain.SpanEvent,
      ): Effect.Effect<void> =>
        Effect.suspend(() => {
          const span = nodes.get(event.spanId)
          if (span === undefined) {
            return Effect.void
          }
          span.events.events.push(new SpanEventNode(span.span, event))
          return refresh(Option.some(span))
        })

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(rootNodes),
          onSome: node => Effect.succeed(children(nodes, node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(Clients.Default))

// === helpers ===

const children = (
  nodes: Map<string, TreeNode>,
  node: TreeNode,
): Option.Option<Array<TreeNode>> => {
  switch (node._tag) {
    case "SpanNode": {
      const nodes: Array<TreeNode> = [
        new InfoNode("Trace ID", node.span.traceId),
        new InfoNode("Span ID", node.span.spanId),
      ]

      node.attributes.forEach((value, key) => {
        nodes.push(new InfoNode(key, Inspectable.toStringUnknown(value)))
      })

      if (node.events.hasEvents) {
        nodes.push(node.events)
      }

      if (node.children.length > 0) {
        nodes.push(new ChildrenNode(node.children))
      }

      return Option.some(nodes)
    }
    case "InfoNode": {
      return Option.none()
    }
    case "ChildrenNode": {
      return Option.some(node.childrenSpanIds.map(id => nodes.get(id)!))
    }
    case "EventsNode": {
      return Option.some(node.events)
    }
    case "SpanEventNode": {
      const attributes = Object.entries(node.event.attributes)
      if (attributes.length === 0) {
        return Option.none()
      }
      return Option.some(
        attributes.map(
          ([key, value]) =>
            new InfoNode(key, Inspectable.toStringUnknown(value)),
        ),
      )
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "SpanNode": {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      const duration = node.duration
      item.id = node.span.spanId
      item.description =
        duration._tag === "Some" ? DurationUtils.format(duration.value) : ""
      return item
    }
    case "InfoNode": {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.None,
      )
      item.description = node.description
      item.tooltip = node.description
      item.contextValue = "info"
      return item
    }
    case "ChildrenNode": {
      return new vscode.TreeItem(
        "Child spans",
        vscode.TreeItemCollapsibleState.Expanded,
      )
    }
    case "EventsNode": {
      return new vscode.TreeItem(
        `Events (${node.events.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
    }
    case "SpanEventNode": {
      const item = new vscode.TreeItem(
        node.event.name,
        node.hasAttributes
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      )
      const duration = node.duration
      if (duration._tag === "Some") {
        item.description = DurationUtils.format(duration.value)
      }
      return item
    }
  }
}
