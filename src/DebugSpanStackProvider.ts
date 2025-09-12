import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { minimatch } from "minimatch"
import * as vscode from "vscode"
import type * as DebugChannel from "./DebugChannel"
import * as Debug from "./DebugEnv"
import {
  configWithDefault,
  executeCommand,
  registerCommand,
  revealFile,
  TreeDataProvider,
  treeDataProvider,
  vscodeUriFromPath
} from "./VsCode"

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

class IgnoredNode {
  readonly _tag = "IgnoredNode"
}

type TreeNode = SpanNode | AttributeNode | VariableNode | IgnoredNode

export const DebugSpanStackProviderLive = treeDataProvider<TreeNode>("effect-debug-span-stack")(
  (refresh) =>
    Effect.gen(function*() {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TreeNode> = []

      // handle ignore list, so user can filter out spans that match the patterns
      const ignoreList = yield* configWithDefault<Array<string>>(
        "effect.spanStack",
        "ignoreList",
        []
      )
      let skipIgnoreList = false
      yield* ignoreList.changes.pipe(Stream.mapEffect(() => refresh(Option.none())), Stream.runDrain, Effect.forkScoped)

      const setSkipIgnoreList = (skip: boolean) => {
        skipIgnoreList = skip
        return refresh(Option.none()).pipe(
          Effect.zipRight(executeCommand("setContext", "effect:skipSpanStackIgnoreList", skip))
        )
      }

      const visibleNodes = Effect.gen(function*() {
        const ignoreListValue = yield* ignoreList.get
        if (skipIgnoreList || ignoreListValue.length === 0) return nodes
        const result = []
        for (const node of nodes) {
          if (node._tag === "SpanNode") {
            const isIgnored = ignoreListValue.some((pattern) => minimatch(node.span.name, pattern))
            if (isIgnored) {
              if (result.length === 0 || result[result.length - 1]._tag !== "IgnoredNode") {
                result.push(new IgnoredNode())
              }
            } else {
              result.push(node)
            }
          }
        }
        return result
      }).pipe(Effect.asSome)

      // allows to toggle ignore list
      yield* registerCommand("effect.enableSpanStackIgnoreList", () => setSkipIgnoreList(true))
      yield* registerCommand("effect.disableSpanStackIgnoreList", () => setSkipIgnoreList(false))

      // jump to span location
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
          onNone: () => visibleNodes,
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
    case "IgnoredNode": {
      return Effect.succeedNone
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
      item.contextValue = "span"
      if (node.span.path) {
        item.description = vscode.workspace.asRelativePath(vscodeUriFromPath(node.span.path)) + ":" + node.span.line +
          ":" +
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
      item.contextValue = "attribute"
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
      item.contextValue = "variable"
      item.description = node.variable.value
      item.tooltip = node.variable.value
      return item
    }
    case "IgnoredNode": {
      const item = new vscode.TreeItem("", vscode.TreeItemCollapsibleState.None)
      item.contextValue = "ignored"
      item.description = "...ignored..."
      return item
    }
  }
}
