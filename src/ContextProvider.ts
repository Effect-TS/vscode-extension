import {
  Effect,
  Layer,
  Option,
  ReadonlyArray,
  Stream,
  SubscriptionRef,
} from "effect"
import * as vscode from "vscode"
import * as Debug from "./DebugEnv"
import {
  TreeDataProvider,
  VsCodeDebugSession,
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

      const capture = Effect.gen(function* (_) {
        const sessionOption = yield* _(SubscriptionRef.get(debug.session))
        if (Option.isNone(sessionOption)) {
          nodes = []
        } else {
          const session = sessionOption.value
          const pairs = yield* _(session.context)
          nodes = pairs.map(_ => new TagNode(_))
        }
        yield* _(refresh(Option.none()))
      })

      yield* _(
        Stream.fromPubSub(debug.messages),
        Stream.mapEffect(event => {
          if (event.type !== "event") return Effect.unit

          switch (event.event) {
            case "stopped": {
              return Effect.delay(capture, 500)
            }
            case "continued": {
              nodes = []
              return refresh(Option.none())
            }
            default: {
              return Effect.unit
            }
          }
        }),
        Stream.runDrain,
        Effect.forkScoped,
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
        node.pair.tag + ":",
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = node.pair.service.value
      item.tooltip = node.pair.service.value
      return item
    }
    case "VariableNode": {
      const item = new vscode.TreeItem(
        node.variable.name + ":",
        node.variable.variablesReference === 0
          ? vscode.TreeItemCollapsibleState.None
          : vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.description = node.variable.value
      item.tooltip = node.variable.value
      return item
    }
  }
}
