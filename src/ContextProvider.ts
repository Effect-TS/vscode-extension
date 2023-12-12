import { Effect, Layer, Option, ReadonlyArray, SubscriptionRef } from "effect"
import * as vscode from "vscode"
import * as Debug from "./DebugEnv"
import {
  TreeDataProvider,
  VsCodeDebugSession,
  registerCommand,
  treeDataProvider,
} from "./VsCode"

class TagNode {
  readonly _tag = "TagNode"
  constructor(readonly pair: Debug.ContextPair) {}
}

class VariableNode {
  readonly _tag = "VariableNode"
  constructor(readonly variable: Debug.Variable) {}
}

type TreeNode = TagNode | VariableNode

export const ContextProviderLive = treeDataProvider<TreeNode>("effect-context")(
  refresh =>
    Effect.gen(function* (_) {
      const debug = yield* _(Debug.DebugEnv)
      let nodes: Array<TagNode> = []

      yield* _(
        registerCommand("effect.captureContext", () =>
          Effect.gen(function* (_) {
            const sessionOption = yield* _(SubscriptionRef.get(debug.session))
            if (Option.isNone(sessionOption)) {
              return
            }
            const session = sessionOption.value
            const pairs = yield* _(session.context)
            nodes = pairs.map(_ => new TagNode(_))
            yield* _(refresh(Option.none()))
          }),
        ),
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(nodes),
          onSome: node =>
            SubscriptionRef.get(debug.session).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.succeedNone,
                  onSome: session =>
                    Effect.provideService(
                      children(node),
                      VsCodeDebugSession,
                      session.vscode,
                    ),
                }),
              ),
            ),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(Debug.DebugEnvLive))

// === helpers ===

const children = (node: TreeNode) => {
  switch (node._tag) {
    case "TagNode": {
      return node.pair.service.children.pipe(
        Effect.map(ReadonlyArray.map(_ => new VariableNode(_))),
        Effect.asSome,
      )
    }
    case "VariableNode": {
      return node.variable.children.pipe(
        Effect.map(ReadonlyArray.map(_ => new VariableNode(_))),
        Effect.asSome,
      )
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "TagNode": {
      const item = new vscode.TreeItem(
        node.pair.tag,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = node.pair.service.value
      return item
    }
    case "VariableNode": {
      const item = new vscode.TreeItem(
        node.variable.name,
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = node.variable.value
      return item
    }
  }
}
