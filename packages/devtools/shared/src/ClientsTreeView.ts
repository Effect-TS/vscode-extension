import * as Array from "effect/Array"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtIcon from "./core/ExtIcon.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as Clients from "./DevtoolClients.ts"
import * as Commands from "./DevtoolCommands.ts"

class ClientNode extends Data.TaggedClass("ClientNode")<{
  clientId: number
  client: Clients.Client
  active: boolean
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.gen(this, function*() {
      const command = yield* Commands.SelectClient.withArgs({ clientId: this.client.id })
      return {
        id: `client-${this.client.id}`,
        label: this.client.name,
        icon: this.active ? ExtIcon.circleFilled : ExtIcon.circle,
        collapsibleState: "none" as const,
        command
      }
    })
  }
}

class RunningStateNode extends Data.TaggedClass("RunningStateNode")<{
  runningState: Clients.RunningState
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const { cause, port, running } = this.runningState
    const label = running
      ? `Server listening on port ${port}`
      : cause._tag === "Empty"
      ? "Server disabled"
      : `Error starting server on port ${port}`

    return Effect.succeed({
      id: "running-state",
      label,
      description: cause._tag !== "Empty" ? Cause.pretty(cause) : "",
      collapsibleState: "none" as const
    })
  }
}

type TreeNode = ClientNode | RunningStateNode

export const ClientsTree = ExtTreeView.make<TreeNode>()("effect-clients", {
  title: "Clients"
})

export const ClientsTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const appScope = yield* Effect.scope
  const clients = yield* Clients.DevtoolClients
  const nodesRef = yield* SubscriptionRef.make<Array<TreeNode>>([])

  const treeViewProvider = ClientsTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when clients or active client change
      yield* clients.clients.changes.pipe(
        Stream.merge(clients.activeClient.changes),
        Stream.merge(clients.running.changes),
        Stream.runForEach(() =>
          Effect.gen(function*() {
            const currentClients = yield* clients.clients.get
            const currentActiveClient = yield* SubscriptionRef.get(clients.activeClient)
            const clientNodes = [...currentClients].map((client) =>
              new ClientNode({
                clientId: client.id,
                client,
                active: Equal.equals(currentActiveClient, Option.some(client))
              })
            )
            yield* SubscriptionRef.set(nodesRef, clientNodes)
            return yield* refresh(Option.none())
          })
        ),
        Effect.forkIn(appScope)
      )

      return {
        treeItem: (element) => element.treeItem(),
        children: Option.match({
          onNone: () =>
            Effect.gen(function*() {
              const nodes = yield* SubscriptionRef.get(nodesRef)
              const runningState = yield* SubscriptionRef.get(clients.running)

              if (runningState.running || nodes.length > 0) {
                return Option.some(nodes.length ? nodes : [new RunningStateNode({ runningState })])
              }

              if (runningState.cause._tag === "Empty") {
                return Option.none()
              }

              return Option.some([new RunningStateNode({ runningState })])
            }),
          onSome: (node: TreeNode) => node.children()
        })
      }
    })
  )

  const selectClientCommand = Commands.SelectClient.toLayer(Effect.gen(function*() {
    return ({ clientId }: { clientId: number }) =>
      Effect.gen(function*() {
        const current = yield* clients.clients.get
        const client = Array.findFirst(current, (_) => _.id === clientId)
        if (client._tag === "None") {
          return
        }
        yield* SubscriptionRef.set(clients.activeClient, client)
      })
  }))

  return treeViewProvider.pipe(
    Layer.provideMerge(selectClientCommand)
  )
}))
