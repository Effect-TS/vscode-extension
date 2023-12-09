import * as DevTools from "@effect/experimental/DevTools"
import * as SocketServer from "@effect/experimental/SocketServer/Node"
import {
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Order,
  Queue,
  Ref,
  Schedule,
  Stream,
  pipe,
} from "effect"
import * as vscode from "vscode"
import { TreeDataProvider, registerCommand, treeDataProvider } from "./VsCode"
import * as DurationUtils from "./utils/Duration"
import { Client, Clients, ClientsLive } from "./Clients"
import * as Domain from "@effect/experimental/DevTools/Domain"

const SpanOrder = Order.struct({
  span: Order.struct({
    status: Order.struct({ startTime: Order.reverse(Order.bigint) }),
  }),
})

const ClientOrder = Order.struct({
  id: Order.reverse(Order.number),
})

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
      let currentClient: Fiber.RuntimeFiber<never, never> | undefined

      const reset = Effect.gen(function* (_) {
        if (currentClient) {
          yield* _(Fiber.interrupt(currentClient))
          currentClient = undefined
        }
        rootNodes.length = 0
        nodes.clear()
        return yield* _(refresh(Option.none()))
      })

      yield* _(
        clients.activeClient.changes,
        Stream.runForEach(_ =>
          Option.match(_, {
            onNone: () => reset,
            onSome: handleClient,
          }),
        ),
        Effect.forkScoped,
      )

      const handleClient = (client: Client) =>
        client.spans.take.pipe(
          Effect.flatMap(registerSpan),
          Effect.forever,
          Effect.fork,
          Effect.tap(fiber => {
            currentClient = fiber
          }),
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
