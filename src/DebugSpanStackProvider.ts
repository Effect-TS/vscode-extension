import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import type * as DebugChannel from "./DebugChannel"
import * as Debug from "./DebugEnv"
import { registerCommand, revealFile, TreeDataProvider, treeDataProvider } from "./VsCode"

class SpanNode {
  readonly _tag = "SpanNode"
  constructor(readonly span: Debug.SpanStackEntry) {}
}

class AttributeNode {
  readonly _tag = "AttributeNode"
  constructor(readonly name: string, readonly variable: DebugChannel.VariableReference) {}
}

class VariableNode {
  readonly _tag = "VariableNode"
  constructor(readonly variable: DebugChannel.VariableReference) {}
}

type TreeNode = SpanNode | AttributeNode | VariableNode

export const DebugSpanStackProviderLive = treeDataProvider<TreeNode>("effect-debug-span-stack")(
  (refresh) =>
    Effect.gen(function*() {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TreeNode> = []

      yield* registerCommand("effect.revealSpanLocation", (node: TreeNode) => {
        if (node && node._tag === "SpanNode" && node.span.path) {
          return revealFile(
            node.span.path,
            new vscode.Range(node.span.line, node.span.column, node.span.line, node.span.column)
          )
        }
        return Effect.void
      })

      const capture = (threadId?: number) =>
        Effect.gen(function*(_) {
          const sessionOption = yield* _(SubscriptionRef.get(debug.session))
          if (Option.isNone(sessionOption)) {
            nodes = []
          } else {
            const session = sessionOption.value
            const pairs = yield* _(session.currentSpanStack(threadId))
            nodes = pairs.map((_) => new SpanNode(_))
          }
          yield* _(refresh(Option.none()))
        })

      yield* Stream.fromPubSub(debug.messages).pipe(
        Stream.mapEffect((event) => {
          if (event.type !== "event") return Effect.void

          switch (event.event) {
            case "stopped": {
              return Effect.delay(capture(event.body?.threadId), 500)
            }
            case "continued": {
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
          onSome: (node) => children(node)
        }),
        treeItem: (node) => Effect.succeed(treeItem(node))
      })
    })
)

// === helpers ===

const children = (node: TreeNode) => {
  switch (node._tag) {
    case "SpanNode": {
      if (node.span.attributes.length > 0) {
        return Effect.succeedSome(
          Array.map(node.span.attributes, ([name, variable]) => new AttributeNode(name, variable))
        )
      }
      return Effect.succeedNone
    }
    case "AttributeNode": {
      return node.variable.children.pipe(
        Effect.map(Array.map((_) => new VariableNode(_))),
        Effect.orElseSucceed(() => []),
        Effect.asSome
      )
    }
    case "VariableNode": {
      return node.variable.children.pipe(
        Effect.map(Array.map((_) => new VariableNode(_))),
        Effect.orElseSucceed(() => []),
        Effect.asSome
      )
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "SpanNode": {
      const item = new vscode.TreeItem(
        node.span.name,
        node.span.attributes.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      )
      if (node.span.path) {
        item.description = vscode.workspace.asRelativePath(node.span.path) + ":" + node.span.line + ":" +
          node.span.column
      }
      if (node.span.stackIndex >= 1) {
        item.iconPath = new vscode.ThemeIcon("indent")
      }
      item.tooltip = node.span.spanId
      return item
    }
    case "AttributeNode": {
      const item = new vscode.TreeItem(
        node.name + ":",
        node.variable.isContainer
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None
      )
      item.description = node.variable.value
      item.tooltip = node.variable.value
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
