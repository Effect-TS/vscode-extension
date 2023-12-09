import { Effect, Layer, Option, Stream } from "effect"
import { Client, Clients, ClientsLive } from "./Clients"
import { TreeDataProvider, treeDataProvider } from "./VsCode"
import * as vscode from "vscode"

class ClientNode {
  constructor(readonly client: Client) {}
}

export const ClientsProviderLive = treeDataProvider<ClientNode>(
  "effect-clients",
)(refresh =>
  Effect.gen(function* (_) {
    const clients = yield* _(Clients)
    let nodes: Array<ClientNode> = []

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

    return TreeDataProvider<ClientNode>({
      children: Option.match({
        onNone: () => Effect.succeedSome(nodes),
        onSome: _node => Effect.succeedNone,
      }),
      treeItem: node =>
        Effect.sync(() => {
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
        }),
    })
  }),
).pipe(Layer.provide(ClientsLive))
