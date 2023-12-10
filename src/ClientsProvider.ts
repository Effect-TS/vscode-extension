import { Cause, Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import { Client, Clients, ClientsLive, RunningState } from "./Clients"
import { TreeDataProvider, treeDataProvider } from "./VsCode"
import * as vscode from "vscode"

class ClientNode {
  readonly _tag = "ClientNode"
  constructor(readonly client: Client) {}
}

type TreeNode = ClientNode | RunningState

export const ClientsProviderLive = treeDataProvider<TreeNode>("effect-clients")(
  refresh =>
    Effect.gen(function* (_) {
      const clients = yield* _(Clients)
      let nodes: Array<ClientNode> = []
      let runningState = yield* _(SubscriptionRef.get(clients.running))

      yield* _(
        clients.clients.changes,
        Stream.runForEach(clients =>
          Effect.suspend(() => {
            nodes = [...clients].map(client => new ClientNode(client))
            return refresh(Option.none())
          }),
        ),
        Effect.forkScoped,
      )
      yield* _(
        clients.running.changes,
        Stream.runForEach(state =>
          Effect.suspend(() => {
            runningState = state
            return refresh(Option.none())
          }),
        ),
        Effect.forkScoped,
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () =>
            Effect.succeedSome(nodes.length ? nodes : [runningState]),
          onSome: _node => Effect.succeedNone,
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(ClientsLive))

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "ClientNode": {
      const item = new vscode.TreeItem(
        `Client #${node.client.id}`,
        vscode.TreeItemCollapsibleState.None,
      )
      item.id = `client-${node.client.id}`
      item.command = {
        command: "effect.selectClient",
        title: "Select Client",
        arguments: [node.client.id],
      }
      return item
    }
    case "RunningState": {
      const item = new vscode.TreeItem(
        node.running
          ? `Server listening on port ${node.port}`
          : node.cause._tag === "Empty"
            ? "Server disabled"
            : Cause.pretty(node.cause),
        vscode.TreeItemCollapsibleState.None,
      )
      return item
    }
  }
}
