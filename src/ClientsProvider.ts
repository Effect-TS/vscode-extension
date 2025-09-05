import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import type { Client, RunningState } from "./Clients"
import { Clients } from "./Clients"
import { TreeDataProvider, treeDataProvider } from "./VsCode"

class ClientNode {
  readonly _tag = "ClientNode"
  constructor(readonly client: Client, readonly active: boolean) {}
}

type TreeNode = ClientNode | RunningState

export const ClientsProviderLive = treeDataProvider<TreeNode>("effect-clients")(
  (refresh) =>
    Effect.gen(function*() {
      const clients = yield* Clients
      let nodes: Array<ClientNode> = []
      let runningState = yield* SubscriptionRef.get(clients.running)

      yield* Stream.merge(clients.clients.changes, clients.activeClient.changes).pipe(
        Stream.runForEach(() =>
          Effect.gen(function*() {
            const currentClients = yield* SubscriptionRef.get(clients.clients)
            const currentActiveClient = yield* SubscriptionRef.get(clients.activeClient)
            nodes = [...currentClients].map((client) =>
              new ClientNode(client, Equal.equals(currentActiveClient, Option.some(client)))
            )
            return yield* refresh(Option.none())
          })
        ),
        Effect.forkScoped
      )
      yield* clients.running.changes.pipe(
        Stream.runForEach((state) =>
          Effect.suspend(() => {
            runningState = state
            return refresh(Option.none())
          })
        ),
        Effect.forkScoped
      )

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () =>
            runningState.running || nodes.length > 0
              ? Effect.succeedSome(nodes.length ? nodes : [runningState])
              : runningState.cause._tag === "Empty"
              ? Effect.succeedNone
              : Effect.succeedSome([runningState]),
          onSome: (_node) => Effect.succeedNone
        }),
        treeItem: (node) => Effect.succeed(treeItem(node))
      })
    })
)

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "ClientNode": {
      const item = new vscode.TreeItem(
        node.client.name,
        vscode.TreeItemCollapsibleState.None
      )
      item.id = `client-${node.client.id}`
      item.command = {
        command: "effect.selectClient",
        title: "Select Client",
        arguments: [node.client.id]
      }
      item.iconPath = node.active ? new vscode.ThemeIcon("circle-filled") : new vscode.ThemeIcon("circle")
      return item
    }
    case "RunningState": {
      const item = new vscode.TreeItem(
        node.running
          ? `Server listening on port ${node.port}`
          : node.cause._tag === "Empty"
          ? "Server disabled"
          : "Error starting server on port " + node.port,
        vscode.TreeItemCollapsibleState.None
      )
      if (node.cause._tag !== "Empty") {
        item.description = Cause.pretty(node.cause)
        item.tooltip = Cause.pretty(node.cause)
      }
      return item
    }
  }
}
