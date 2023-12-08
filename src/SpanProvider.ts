import { TreeDataProvider, listen, treeDataProvider } from "./VsCode"
import {
  Duration,
  Effect,
  Fiber,
  Option,
  Order,
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

const nodes = new Map<string, SpanNode>()

class SpanNode implements vscode.Disposable {
  private _onChildAdded = new vscode.EventEmitter<SpanNode>()
  public readonly onChildAdded = this._onChildAdded.event

  constructor(public span: DevTools.Span) {
    nodes.set(span.spanId, this)
    if (span.parent._tag === "Some" && span.parent.value._tag === "Span") {
      const parent = SpanNode.fromSpan(span.parent.value)
      parent.addChild(this)
    }
  }

  static fromSpan(span: DevTools.Span): SpanNode {
    const node = nodes.get(span.spanId)
    if (node !== undefined) {
      node.span = span
      return node
    }
    return new SpanNode(span)
  }

  get isRoot() {
    return (
      this.span.parent._tag === "None" || this.span.parent.value._tag !== "Span"
    )
  }

  get parent(): Option.Option<SpanNode> {
    if (
      this.span.parent._tag === "None" ||
      this.span.parent.value._tag !== "Span"
    ) {
      return Option.none()
    }
    const node = SpanNode.fromSpan(this.span.parent.value)
    return Option.some(node)
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
    this._onChildAdded.fire(child)
  }

  dispose() {
    this._onChildAdded.dispose()
    nodes.delete(this.span.spanId)
  }
}

export const SpanProviderLive = treeDataProvider<SpanNode>("effect-tracer")(
  refresh =>
    Effect.gen(function* (_) {
      const scope = yield* _(Effect.scope)

      const rootSpans: Array<SpanNode> = []
      const registeredSpans = new Map<
        SpanNode,
        Fiber.RuntimeFiber<never, never>
      >()
      const registerSpan = (
        span: DevTools.Span,
      ): Effect.Effect<never, never, void> => {
        const node = SpanNode.fromSpan(span)
        if (registeredSpans.has(node)) {
          return refresh(node.parent)
        }
        return listen(node.onChildAdded, child =>
          Effect.zipRight(registerSpan(child.span), refresh(Option.some(node))),
        ).pipe(
          Effect.forkIn(scope),
          Effect.tap(fiber => {
            registeredSpans.set(node, fiber)
            if (node.isRoot) {
              rootSpans.push(node)
              rootSpans.sort(SpanOrder)
            }
            return refresh(node.parent)
          }),
          Effect.asUnit,
        )
      }
      const unregisterSpan = (
        span: DevTools.Span,
      ): Effect.Effect<never, never, void> => {
        const node = SpanNode.fromSpan(span)
        const fiber = registeredSpans.get(node)
        const index = rootSpans.indexOf(node)
        if (fiber !== undefined) {
          registeredSpans.delete(node)
          if (index >= 0) {
            rootSpans.splice(index, 1)
          }
          return Fiber.interrupt(fiber)
        }
        return Effect.unit
      }
      const reset = Effect.suspend(() => {
        const entries = Array.from(registeredSpans.entries())
        rootSpans.length = 0
        registeredSpans.clear()

        return Effect.forEach(
          entries,
          ([node, fiber]) => {
            node.dispose()
            return Fiber.interrupt(fiber)
          },
          { discard: true },
        )
      })

      yield* _(
        DevTools.makeClient(),
        Stream.runForEach(registerSpan),
        Effect.tapErrorCause(Effect.logError),
        Effect.ensuring(reset),
        Effect.retry(
          Schedule.exponential("500 millis").pipe(
            Schedule.union(Schedule.spaced("10 seconds")),
          ),
        ),
        Effect.forkScoped,
      )

      return TreeDataProvider({
        children: Option.match({
          onNone: () => Effect.succeedSome(rootSpans),
          onSome: node =>
            Effect.succeed(
              node.children.length > 0
                ? Option.some(node.children)
                : Option.none(),
            ),
        }),
        treeItem: node => {
          const item = new vscode.TreeItem(
            node.span.name,
            node.children.length === 0
              ? vscode.TreeItemCollapsibleState.None
              : vscode.TreeItemCollapsibleState.Collapsed,
          )
          const duration = node.duration
          item.description =
            duration._tag === "Some" ? Duration.format(duration.value) : ""
          return Effect.succeed(item)
        },
      })
    }),
)
