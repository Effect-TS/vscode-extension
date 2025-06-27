import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Array from "effect/Array"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import * as Debug from "./DebugEnv"
import {
  TreeDataProvider,
  VsCodeDebugSession,
  registerCommand,
  revealFile,
  treeDataProvider,
} from "./VsCode"

class TreeNode {
    constructor(readonly entry: Debug.SpanStackEntry) {}
}

export const CurrentSpanStackProviderLive = treeDataProvider<TreeNode>("effect-current-span-stack")(
  refresh =>
    Effect.gen(function* () {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TreeNode> = []

      yield* registerCommand("effect.revealSpanLocation", (node: TreeNode) => {
        if(node && node.entry.path){
          return revealFile(node.entry.path, new vscode.Range(node.entry.line, node.entry.column, node.entry.line, node.entry.column))
        }
        return Effect.void
      })

      const capture = Effect.gen(function* (_) {
        const sessionOption = yield* _(SubscriptionRef.get(debug.session))
        if (Option.isNone(sessionOption)) {
          nodes = []
        } else {
          const session = sessionOption.value
          const pairs = yield* _(session.currentSpanStack)
          nodes = pairs.map(_ => new TreeNode(_))
        }
        yield* _(refresh(Option.none()))
      })

      yield* Stream.fromPubSub(debug.messages).pipe(
        Stream.mapEffect(event => {
          if (event.type !== "event") return Effect.void

          switch (event.event) {
            case "stopped": {
              return Effect.delay(capture, 50)
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
        Effect.forkScoped,
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(nodes),
          onSome: () => Effect.succeedNone
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(Debug.DebugEnv.Live))

// === helpers ===


const treeItem = (node: TreeNode): vscode.TreeItem => {
      const item = new vscode.TreeItem(
        node.entry.name,
        vscode.TreeItemCollapsibleState.None
      )
      if(node.entry.path) {        
        item.description = vscode.workspace.asRelativePath(node.entry.path) + ":" + node.entry.line + ":" + node.entry.column
      }
      item.tooltip = node.entry.spanId
      return item
    }

