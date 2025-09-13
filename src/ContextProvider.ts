import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import type * as DebugChannel from "./DebugChannel"
import * as Debug from "./DebugEnv"
import { TreeDataProvider, treeDataProvider } from "./VsCode"

class TagNode {
  readonly _tag = "TagNode"
  constructor(readonly pair: Debug.ContextPair) {}
}

class VariableNode {
  readonly _tag = "VariableNode"
  constructor(readonly variable: DebugChannel.VariableReference) {}
}

type TreeNode = TagNode | VariableNode

export const ContextProviderLive = treeDataProvider<TreeNode>("effect-context")(
  (refresh) =>
    Effect.gen(function*() {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TagNode> = []

      const capture = (threadId?: number) =>
        Effect.gen(function*() {
          const sessionOption = yield* (SubscriptionRef.get(debug.session))
          if (Option.isNone(sessionOption)) {
            nodes = []
          } else {
            const session = sessionOption.value
            const pairs = yield* (session.context(threadId))
            nodes = pairs.map((_) => new TagNode(_))
          }
          yield* (refresh(Option.none()))
        })

      yield* Stream.fromPubSub(debug.events).pipe(
        Stream.mapEffect((event) => {
          switch (event._tag) {
            case "DebuggerThreadStopped": {
              return Effect.delay(capture(event.threadId), 500)
            }
            case "DebuggerThreadContinued": {
              nodes = []
              return refresh(Option.none())
            }
            default: {
              return Effect.void
            }
          }
        }),
        Stream.runDrain,
        Effect.forkScoped
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(nodes),
          onSome: (node) =>
            SubscriptionRef.get(debug.session).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeedNone,
                  onSome: () => children(node)
                })
              ),
              Effect.orElse(() => Effect.succeedNone)
            )
        }),
        treeItem: (node) => Effect.succeed(treeItem(node))
      })
    })
)

// === helpers ===

const children = (node: TreeNode) => {
  switch (node._tag) {
    case "TagNode": {
      return node.pair.service.children.pipe(
        Effect.map(Array.map((_) => new VariableNode(_))),
        Effect.asSome
      )
    }
    case "VariableNode": {
      return node.variable.children.pipe(
        Effect.map(Array.map((_) => new VariableNode(_))),
        Effect.asSome
      )
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "TagNode": {
      const item = new vscode.TreeItem(
        node.pair.tag + ":",
        vscode.TreeItemCollapsibleState.Collapsed
      )
      item.description = node.pair.service.value
      item.tooltip = node.pair.service.value
      return item
    }
    case "VariableNode": {
      const item = new vscode.TreeItem(
        node.variable.name + ":",
        node.variable.isContainer
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      )
      item.description = node.variable.value
      item.tooltip = node.variable.value
      return item
    }
  }
}
