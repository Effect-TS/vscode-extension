import { TreeDataProvider, registerCommand, treeDataProvider } from "./VsCode"
import {
  Duration,
  Effect,
  Option,
  Order,
  Queue,
  Schedule,
  Stream,
} from "effect"
import * as vscode from "vscode"
import * as DevTools from "@effect/experimental/DevTools"

const SpanOrder = Order.struct({
  span: Order.struct({
    status: Order.struct({ startTime: Order.reverse(Order.bigint) }),
  }),
})

class SpanNode {
  readonly _tag = "SpanNode"

  constructor(public span: DevTools.Span) {}

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

type TreeNode = SpanNode | InfoNode | ChildrenNode

export const SpanProviderLive = treeDataProvider<TreeNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* (_) {
      const nodes = new Map<string, SpanNode>()
      const rootNodes: Array<SpanNode> = []

      function addNode(span: DevTools.Span): [SpanNode, SpanNode | undefined] {
        let node = nodes.get(span.spanId)
        let parent: SpanNode | undefined
        if (node === undefined) {
          node = new SpanNode(span)
          nodes.set(span.spanId, node)

          if (node.isRoot) {
            rootNodes.push(node)
            rootNodes.sort(SpanOrder)
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
        span: DevTools.Span,
      ): Effect.Effect<never, never, void> =>
        Effect.suspend(() => {
          const [, parent] = addNode(span)
          return refresh(Option.fromNullable(parent))
        })
      // const unregisterSpan = (
      //   span: DevTools.Span,
      // ): Effect.Effect<never, never, void> => {
      //   const node = SpanNode.fromSpan(span)
      //   const fiber = registeredSpans.get(node)
      //   const index = rootSpans.indexOf(node)
      //   if (fiber !== undefined) {
      //     registeredSpans.delete(node)
      //     if (index >= 0) {
      //       rootSpans.splice(index, 1)
      //     }
      //     return Fiber.interrupt(fiber)
      //   }
      //   return Effect.unit
      // }
      const reset = Effect.sync(() => {
        rootNodes.length = 0
        nodes.clear()
      })

      const reconnectQueue = yield* _(Queue.unbounded<void>())

      yield* _(
        reset,
        Effect.zipRight(Stream.runForEach(DevTools.makeClient(), registerSpan)),
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
        registerCommand("effect-vscode.tracerReconnect", () =>
          reconnectQueue.offer(void 0),
        ),
      )

      const children = (node: TreeNode): Option.Option<Array<TreeNode>> => {
        switch (node._tag) {
          case "SpanNode": {
            const nodes: Array<TreeNode> = []

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
            item.description =
              duration._tag === "Some" ? Duration.format(duration.value) : ""
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
              vscode.TreeItemCollapsibleState.Collapsed,
            )
          }
        }
      }

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(rootNodes),
          onSome: node => Effect.succeed(children(node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
)
