import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as vscode from "vscode"
import { Client, Clients, ClientsLive } from "./Clients"
import { TreeDataProvider, treeDataProvider } from "./VsCode"
import * as DurationUtils from "./utils/Duration"

class SpanNode {
  readonly _tag = "SpanNode"

  constructor(public span: Domain.Span) {}

  get isRoot() {
    return (
      this.span.parent._tag === "None" || this.span.parent.value._tag !== "Span"
    )
  }

  get duration(): Option.Option<Duration.Duration> {
    if (this.span.status._tag === "Ended") {
      return Option.some(
        Duration.nanos(this.span.status.endTime - this.span.status.startTime),
      )
    }
    return Option.none()
  }

  private _children: Array<SpanNode> = []
  get children(): Array<SpanNode> {
    return this._children
  }

  addChild(child: SpanNode) {
    if (this._children.includes(child)) {
      return
    }
    this._children.unshift(child)
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
  constructor(readonly children: Array<SpanNode>) {}
}

type TreeNode = SpanNode | InfoNode | ChildrenNode

export const SpanProviderLive = treeDataProvider<TreeNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* (_) {
      const clients = yield* _(Clients)
      const rootNodes: Array<SpanNode> = []
      const nodes = new Map<string, SpanNode>()

      const currentClient = yield* _(ScopedRef.make(() => Fiber.never))

      const reset = Effect.gen(function* (_) {
        yield* _(ScopedRef.set(currentClient, Effect.succeed(Fiber.never)))
        rootNodes.length = 0
        nodes.clear()
        return yield* _(refresh(Option.none()))
      })

      yield* _(
        clients.activeClient.changes,
        Stream.tap(() => reset),
        Stream.runForEach(_ =>
          Option.match(_, {
            onNone: () => Effect.unit,
            onSome: client =>
              ScopedRef.set(currentClient, handleClient(client)),
          }),
        ),
        Effect.forkScoped,
      )

      const handleClient = (client: Client) =>
        client.spans.take.pipe(
          Effect.flatMap(registerSpan),
          Effect.forever,
          Effect.forkScoped,
        )

      function addNode(span: Domain.Span): [SpanNode, SpanNode | undefined] {
        let node = nodes.get(span.spanId)
        let parent: SpanNode | undefined
        if (node === undefined) {
          node = new SpanNode(span)
          nodes.set(span.spanId, node)

          if (node.isRoot) {
            rootNodes.unshift(node)
          }

          if (
            span.parent._tag === "Some" &&
            span.parent.value._tag === "Span"
          ) {
            parent = addNode(span.parent.value)[0]
            parent.addChild(node)
          }
        } else if (
          span.parent._tag === "Some" &&
          span.parent.value._tag === "Span"
        ) {
          parent = addNode(span.parent.value)[0]
        }

        node.span = span

        return [node, parent]
      }

      const registerSpan = (
        span: Domain.Span,
      ): Effect.Effect<never, never, void> =>
        Effect.suspend(() => {
          const [, parent] = addNode(span)
          return refresh(Option.fromNullable(parent))
        })

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(rootNodes),
          onSome: node => Effect.succeed(children(node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(ClientsLive))

// === helpers ===

const children = (node: TreeNode): Option.Option<Array<TreeNode>> => {
  switch (node._tag) {
    case "SpanNode": {
      const nodes: Array<TreeNode> = [
        new InfoNode("Trace ID", node.span.traceId),
        new InfoNode("Span ID", node.span.spanId),
      ]

      node.span.attributes.forEach((value, key) => {
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
      return Option.some(node.children)
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "SpanNode": {
      const item = new vscode.TreeItem(
        node.span.name,
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
