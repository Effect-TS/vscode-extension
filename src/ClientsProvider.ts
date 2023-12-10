import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import { Client, Clients, ClientsLive } from "./Clients"
import { TreeDataProvider, treeDataProvider } from "./VsCode"
import * as vscode from "vscode"

class ClientNode {
  readonly _tag = "ClientNode"
  constructor(readonly client: Client) {}
}

class RunningStateNode {
  readonly _tag = "RunningStateNode"
  constructor(readonly running: boolean) {}
}

type TreeNode = ClientNode | RunningStateNode

export const ClientsProviderLive = treeDataProvider<
  ClientNode | RunningStateNode
>("effect-clients")(refresh =>
  Effect.gen(function* (_) {
    const clients = yield* _(Clients)
    let nodes: Array<ClientNode> = []
    let running = false

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
      Stream.runForEach(running_ =>
        Effect.suspend(() => {
          running = running_
          return refresh(Option.none())
        }),
      ),
      Effect.forkScoped,
    )

    return TreeDataProvider<TreeNode>({
      children: Option.match({
        onNone: () =>
          Effect.succeedSome(
            nodes.length ? nodes : [new RunningStateNode(running)],
          ),
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
    case "RunningStateNode": {
      const item = new vscode.TreeItem(
        node.running ? "Server listening on port 34437" : "Server disabled",
        vscode.TreeItemCollapsibleState.None,
      )
      return item
    }
  }
}
