import * as DevTools from "@effect/experimental/DevTools"
import * as SocketServer from "@effect/experimental/SocketServer/Node"
import {
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Order,
  Queue,
  Schedule,
  pipe,
} from "effect"
import * as vscode from "vscode"
import { TreeDataProvider, registerCommand, treeDataProvider } from "./VsCode"
import * as DurationUtils from "./utils/Duration"

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

  constructor(
    readonly client: Client,
    public span: DevTools.Span,
  ) {}

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
    this._children.push(child)
    this._children.sort(SpanOrder)
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

class ClientNode {
  readonly _tag = "ClientNode"
  constructor(
    readonly id: number,
    readonly children: () => Array<SpanNode>,
  ) {}
}

type TreeNode = SpanNode | InfoNode | ChildrenNode | ClientNode

export const SpanProviderLive = treeDataProvider<TreeNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* (_) {
      const server = yield* _(DevTools.makeServer)
      let clientId = 0

      const clientNodes: Array<ClientNode> = []
      const reset = Effect.suspend(() => {
        clientNodes.length = 0
        return refresh(Option.none())
      })

      const reconnectQueue = yield* _(Queue.unbounded<void>())
      yield* _(
        registerCommand("effect-vscode.tracerReconnect", () =>
          reconnectQueue.offer(void 0),
        ),
      )

      const take = pipe(
        server.clients.take,
        Effect.flatMap(queue =>
          Effect.gen(function* (_) {
            const id = ++clientId
            const client = yield* _(makeClient(id, queue, refresh))
            clientNodes.push(client.node)
            clientNodes.sort(ClientOrder)
            yield* _(
              client.join,
              Effect.ensuring(
                Effect.suspend(() => {
                  const index = clientNodes.indexOf(client.node)
                  if (index >= 0) {
                    clientNodes.splice(index, 1)
                  }
                  return refresh(Option.none())
                }),
              ),
              Effect.fork,
            )
            return yield* _(refresh(Option.none()))
          }),
        ),
        Effect.forever,
      )

      yield* _(
        reset,
        Effect.zipRight(take),
        Effect.scoped,
        Effect.tapErrorCause(Effect.logError),
        Effect.retry(
          Schedule.exponential("500 millis").pipe(
            Schedule.union(Schedule.spaced("10 seconds")),
          ),
        ),
        Effect.race(reconnectQueue.take),
        Effect.forever,
        Effect.forkScoped,
      )

      yield* _(
        server.run,
        Effect.tapErrorCause(Effect.logError),
        Effect.retry(Schedule.spaced("5 seconds")),
        Effect.forkScoped,
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(clientNodes),
          onSome: node => Effect.succeed(children(node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(
  Layer.provide(
    SocketServer.layerWebSocket({
      port: 34437,
    }),
  ),
)

interface Client {
  readonly join: Effect.Effect<never, never, void>
  readonly node: ClientNode
  readonly rootNodes: () => Array<SpanNode>
}

const makeClient = (
  id: number,
  queue: Queue.Dequeue<DevTools.Span>,
  refresh: (
    data: Option.Option<TreeNode | TreeNode[]>,
  ) => Effect.Effect<never, never, void>,
) =>
  Effect.gen(function* (_) {
    const nodes = new Map<string, SpanNode>()
    const rootNodes: Array<SpanNode> = []
    const deferred = yield* _(Deferred.make<never, void>())

    const client: Client = {
      join: Deferred.await(deferred),
      node: new ClientNode(id, () => rootNodes),
      rootNodes: () => rootNodes,
    }

    function addNode(span: DevTools.Span): [SpanNode, SpanNode | ClientNode] {
      let node = nodes.get(span.spanId)
      let parent: SpanNode | undefined
      if (node === undefined) {
        node = new SpanNode(client, span)
        nodes.set(span.spanId, node)

        if (node.isRoot) {
          rootNodes.push(node)
          rootNodes.sort(SpanOrder)
        }

        if (span.parent._tag === "Some" && span.parent.value._tag === "Span") {
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

      return [node, parent ?? client.node]
    }

    const registerSpan = (
      span: DevTools.Span,
    ): Effect.Effect<never, never, void> =>
      Effect.suspend(() => {
        const [, parent] = addNode(span)
        return refresh(Option.some(parent))
      })

    yield* _(
      Queue.take(queue),
      Effect.flatMap(registerSpan),
      Effect.forever,
      Effect.ensuring(Deferred.complete(deferred, Effect.unit)),
      Effect.forkScoped,
    )

    return client
  })

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
    case "ClientNode": {
      return Option.some(node.children())
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
      item.id = node.label
      item.description = node.description
      return item
    }
    case "ChildrenNode": {
      return new vscode.TreeItem(
        "Child spans",
        vscode.TreeItemCollapsibleState.Collapsed,
      )
    }
    case "ClientNode": {
      const item = new vscode.TreeItem(
        `Client #${node.id}`,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.id = String(node.id)
      return item
    }
  }
}
