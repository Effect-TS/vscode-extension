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
    constructor(readonly entry: Debug.FiberEntry) {}
}

export const DebugFibersProviderLive = treeDataProvider<TreeNode>("effect-debug-fibers")(
  refresh =>
    Effect.gen(function* () {
      const debug = yield* Debug.DebugEnv
      let nodes: Array<TreeNode> = []

    yield* registerCommand("effect.revealFiberCurrentSpan", (node: TreeNode) => {
        if(node && node.entry.stack.length > 0){
            const stackEntry = node.entry.stack[0]
            if(stackEntry.path){
                return revealFile(stackEntry.path, new vscode.Range(stackEntry.line, stackEntry.column, stackEntry.line, stackEntry.column))
            }
        }
        return Effect.void
    })

      const capture = Effect.gen(function* (_) {
        const sessionOption = yield* _(SubscriptionRef.get(debug.session))
        if (Option.isNone(sessionOption)) {
          nodes = []
        } else {
          const session = sessionOption.value
          const pairs = yield* _(session.currentFibers)
          nodes = pairs.map(_ => new TreeNode(_))
        }
        yield* _(refresh(Option.none()))
      })

      yield* Stream.fromPubSub(debug.messages).pipe(
        Stream.mapEffect(event => {
          if (event.type !== "event") return Effect.void

          switch (event.event) {
            case "stopped": {
              return Effect.delay(capture, 500)
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
        "Fiber#" + node.entry.id,
        vscode.TreeItemCollapsibleState.None
      )
      const firstEntry = node.entry.stack[0]
      if(firstEntry){
        item.description = firstEntry.name
        if(firstEntry.path){
            item.tooltip = firstEntry.path + ":" + firstEntry.line + ":" + firstEntry.column
        }
        if(node.entry.isCurrent){
            item.iconPath = new vscode.ThemeIcon("arrow-small-right")
        }
      }
      
      return item
    }

