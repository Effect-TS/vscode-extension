import * as Array from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import type * as DebugChannel from "./DebugChannel"
import * as Debug from "./DebugEnv"
import * as DurationUtils from "./utils/Duration"
import { registerCommand, revealFile, TreeDataProvider, treeDataProvider } from "./VsCode"

class FiberNode {
  readonly _tag = "FiberNode"
  public interruptionRequested = false
  constructor(readonly entry: Debug.FiberEntry) {}
}

class FiberMetadataNode {
  readonly _tag = "FiberMetadataNode"
  constructor(readonly name: string, readonly value: string) {}
}

class AttributeNode {
  readonly _tag = "AttributeNode"
  constructor(readonly name: string, readonly variable: DebugChannel.VariableReference) {}
}

class VariableNode {
  readonly _tag = "VariableNode"
  constructor(readonly variable: DebugChannel.VariableReference) {}
}

type TreeNode = FiberNode | FiberMetadataNode | AttributeNode | VariableNode

export const DebugFibersProviderLive = treeDataProvider<TreeNode>("effect-debug-fibers")(
  (refresh) =>
    Effect.gen(function*() {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TreeNode> = []

      yield* registerCommand("effect.revealFiberCurrentSpan", (node: TreeNode) => {
        if (node && node._tag === "FiberNode" && node.entry.stack.length > 0) {
          const stackEntry = node.entry.stack[0]
          if (stackEntry.path) {
            return revealFile(
              stackEntry.path,
              new vscode.Range(stackEntry.line, stackEntry.column, stackEntry.line, stackEntry.column)
            )
          }
        }
        return Effect.void
      })

      yield* registerCommand("effect.interruptDebugFiber", (node: TreeNode) => {
        if (node && node._tag === "FiberNode") {
          return node.entry.interrupt.pipe(
            Effect.ensuring(Effect.sync(() => node.interruptionRequested = true)),
            Effect.ensuring(refresh(Option.some(node)))
          )
        }
        return Effect.void
      })

      const capture = (threadId?: number) =>
        Effect.gen(function*() {
          const sessionOption = yield* (SubscriptionRef.get(debug.session))
          if (Option.isNone(sessionOption)) {
            nodes = []
          } else {
            const session = sessionOption.value
            const rootData = yield* (session.currentFibers(threadId))
            nodes = rootData.map((_) => new FiberNode(_))
          }
          yield* (refresh(Option.none()))
        })

      yield* Stream.fromPubSub(debug.events).pipe(
        Stream.mapEffect((event) =>
          Effect.gen(function*() {
            switch (event._tag) {
              case "DebuggerThreadStopped": {
                return yield* Effect.delay(capture(event.threadId), 500)
              }
              case "DebuggerThreadContinued": {
                nodes = []
                return yield* refresh(Option.none())
              }
              default: {
                return
              }
            }
          })
        ),
        Stream.runDrain,
        Effect.forkScoped
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(nodes),
          onSome: (node) => {
            switch (node._tag) {
              case "FiberNode": {
                const childs: Array<TreeNode> = [
                  new FiberMetadataNode(
                    "Started At",
                    DateTime.make(node.entry.startTimeMillis).pipe(
                      Option.map(
                        DateTime.formatLocal({ dateStyle: "medium", timeStyle: "long" })
                      ),
                      Option.getOrElse(() => String(node.entry.startTimeMillis))
                    )
                  ),
                  new FiberMetadataNode(
                    "Lifetime",
                    DurationUtils.format(Duration.millis(node.entry.lifeTimeMillis))
                  ),
                  new FiberMetadataNode(
                    "Interruptible",
                    node.entry.isInterruptible ? "true" : "false"
                  ),
                  new FiberMetadataNode(
                    "Interrupted",
                    node.entry.isInterrupted ? "true" : "false"
                  ),
                  ...node.entry.stack[0]?.attributes.map(([name, variable]) => new AttributeNode(name, variable)) ?? [],
                  ...nodes.filter((_) => _._tag === "FiberNode" && node.entry.children.includes(_.entry.id))
                ]
                return Effect.succeedSome(childs)
              }
              case "FiberMetadataNode": {
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
        }),
        treeItem: (node) => Effect.succeed(treeItem(node))
      })
    })
)

// === helpers ===

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "FiberNode": {
      const item = new vscode.TreeItem(
        "Fiber#" + node.entry.id + (node.entry.isInterrupted ? " (interrupting)" : "") +
          (node.entry.isInterruptible ? "" : " (uninterruptible)") +
          (node.interruptionRequested ? " (interruption requested)" : ""),
        vscode.TreeItemCollapsibleState.Collapsed
      )
      item.contextValue = node.interruptionRequested || node.entry.isInterrupted ? "fiber-interrupting" : "fiber"
      if (node.entry.isCurrent) {
        item.iconPath = new vscode.ThemeIcon("arrow-small-right")
      }
      const firstEntry = node.entry.stack[0]
      if (firstEntry) {
        item.description = firstEntry.name
        if (firstEntry.path) {
          item.tooltip = firstEntry.path + ":" + firstEntry.line + ":" + firstEntry.column
        }
      }

      return item
    }
    case "FiberMetadataNode": {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None)
      item.contextValue = "fiberMetadata"
      item.description = node.value
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
  }
}
