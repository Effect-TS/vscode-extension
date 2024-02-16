import * as Domain from "@effect/experimental/DevTools/Domain"
import * as HashSet from "effect/HashSet"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as vscode from "vscode"
import { Client, Clients } from "./Clients"
import { TreeDataProvider, registerCommand, treeDataProvider } from "./VsCode"
import * as DurationUtils from "./utils/Duration"

class SpanNode {
  readonly _tag = "SpanNode"

  constructor(public span: Domain.ParentSpan) {}

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

class InfoNode {
  readonly _tag = "InfoNode"
  constructor(
    readonly label: string,
    readonly description: string,
  ) {}
}

class ChildrenNode {
  readonly _tag = "ChildrenNode"
  constructor(readonly childrenSpanIds: Array<string>) {}
}

type TreeNode = SpanNode | InfoNode | ChildrenNode

export const SpanProviderLive = treeDataProvider<TreeNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* (_) {
      const clients = yield* _(Clients)
      const rootNodes: Array<SpanNode> = []
      const nodes = new Map<string, SpanNode>()

      const reset = Effect.gen(function* (_) {
        rootNodes.length = 0
        nodes.clear()
        return yield* _(refresh(Option.none()))
      })
      yield* _(registerCommand("effect.resetTracer", () => reset))

      const handleClient = (client: Client) =>
        client.spans.take.pipe(Effect.flatMap(registerSpan), Effect.forever)

      yield* _(
        clients.clients.changes,
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

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(rootNodes),
          onSome: node => Effect.succeed(children(nodes, node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(Clients.Live))

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
        nodes.push(new InfoNode(key, String(value)))
      })

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
      return item
    }
    case "ChildrenNode": {
      return new vscode.TreeItem(
        "Child spans",
        vscode.TreeItemCollapsibleState.Expanded,
      )
    }
  }
}
