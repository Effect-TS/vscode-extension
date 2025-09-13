import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import type * as DebugChannel from "./DebugChannel"
import * as Debug from "./DebugEnv"
import { registerCommand, revealFile, TreeDataProvider, treeDataProvider } from "./VsCode"

class PauseOnDefectStatusNode {
  readonly _tag = "PauseOnDefectStatusNode"
  constructor(readonly pauseOnDefects: boolean, readonly threadId: number | undefined) {}
}

class PauseValueToRevealNode {
  readonly _tag = "PauseValueToRevealNode"
  constructor(readonly label: string, readonly variable: DebugChannel.VariableReference) {}
}

class VariableNode {
  readonly _tag = "VariableNode"
  constructor(readonly variable: DebugChannel.VariableReference) {}
}

type TreeNode = PauseOnDefectStatusNode | PauseValueToRevealNode | VariableNode

export const DebugBreakpointsProviderLive = treeDataProvider<TreeNode>("effect-debug-breakpoints")(
  (refresh) =>
    Effect.gen(function*() {
      const debug = yield* Debug.DebugEnv
      let pauseOnDefectsNode: PauseOnDefectStatusNode | null = null
      let pauseValueToRevealNodes: Array<PauseValueToRevealNode> = []

      const visibleNodes = Effect.gen(function*() {
        const nodes: Array<TreeNode> = pauseOnDefectsNode !== null ? [pauseOnDefectsNode] : []
        return nodes.concat(pauseValueToRevealNodes)
      }).pipe(Effect.asSome)

      // toggle pause on defects
      yield* registerCommand("effect.togglePauseOnDefects", (threadId?: number | undefined) =>
        Effect.gen(function*() {
          const session = yield* SubscriptionRef.get(debug.session)
          if (Option.isNone(session)) {
            return
          }
          yield* session.value.togglePauseOnDefects(threadId)
          yield* capture(true, threadId)
        }))

      const capture = (onlyConfig: boolean, threadId?: number) =>
        Effect.gen(function*() {
          const sessionOption = yield* (SubscriptionRef.get(debug.session))
          pauseOnDefectsNode = null
          if (Option.isSome(sessionOption)) {
            const session = sessionOption.value
            const autoPauseConfig = yield* (session.currentAutoPauseConfig(threadId))
            pauseOnDefectsNode = new PauseOnDefectStatusNode(autoPauseConfig.pauseOnDefects, threadId)
            if (!onlyConfig) {
              pauseValueToRevealNodes = []
              const pauseState = yield* (session.getAndUnsetPauseStateToReveal(threadId))
              if (Option.isSome(pauseState.location)) {
                const location = pauseState.location.value
                yield* revealFile(
                  location.path,
                  new vscode.Range(location.line, location.column, location.line, location.column)
                )
              }
              pauseValueToRevealNodes = pauseState.values.map((_) => new PauseValueToRevealNode(_.label, _.value))
            }
          }
          yield* (refresh(Option.none()))
        })

      // upon session shutdown, reset the node
      yield* debug.session.changes.pipe(
        Stream.map((session) => Option.isSome(session) ? undefined : (pauseOnDefectsNode = null)),
        Stream.runDrain,
        Effect.forkScoped
      )

      yield* Stream.fromPubSub(debug.events).pipe(
        Stream.mapEffect((event) => {
          switch (event._tag) {
            case "DebuggerThreadStopped": {
              return capture(false, event.threadId)
            }
            case "DebuggerThreadContinued": {
              pauseValueToRevealNodes = []
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
          onSome: (node) => children(node).pipe(Effect.orElse(() => Effect.succeedNone))
        }),
        treeItem: (node) => Effect.succeed(treeItem(node))
      })
    })
)

// === helpers ===

const children = (node: TreeNode) => {
  switch (node._tag) {
    case "PauseOnDefectStatusNode": {
      return Effect.succeedNone
    }
    case "PauseValueToRevealNode": {
      return node.variable.children.pipe(
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
    case "PauseOnDefectStatusNode": {
      const item = new vscode.TreeItem(
        (node.pauseOnDefects ? "☑" : "☐") + " Pause debug on defects",
        vscode.TreeItemCollapsibleState.None
      )
      item.contextValue = "pauseOnDefects"
      item.command = {
        command: "effect.togglePauseOnDefects",
        title: "Toggle pause on defects",
        arguments: [node.threadId]
      }
      return item
    }
    case "PauseValueToRevealNode": {
      const item = new vscode.TreeItem(
        node.label + ":",
        vscode.TreeItemCollapsibleState.Collapsed
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
