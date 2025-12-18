import * as Array from "effect/Array"
import * as Graph from "effect/Graph"
import * as Order from "effect/Order"

export interface DfsChooseContinueConfig<N> extends Graph.SearchConfig {
  chooseContinue: (data: N) => boolean
  order: Order.Order<Graph.NodeIndex>
}

export const dfsChooseContinue = <N, E, T extends Graph.Kind = "directed">(
  graph: Graph.Graph<N, E, T> | Graph.MutableGraph<N, E, T>,
  config: DfsChooseContinueConfig<N>
): Graph.NodeWalker<N> => {
  const start = config.start ?? []
  const direction = config.direction ?? "outgoing"
  const order = config.order

  return new Graph.Walker((f) => ({
    [Symbol.iterator]: () => {
      const sortedStart = order ? Array.sort(start, Order.reverse(order)) : start
      const stack = [...sortedStart]
      const discovered = new Set<Graph.NodeIndex>()

      const nextMapped = () => {
        while (stack.length > 0) {
          const current = stack.pop()!

          if (discovered.has(current)) {
            continue
          }

          discovered.add(current)

          const nodeDataOption = graph.nodes.get(current)
          if (nodeDataOption === undefined) {
            continue
          }

          if (config.chooseContinue(nodeDataOption)) {
            const neighbors = Graph.neighborsDirected(graph, current, direction)
            const sortedNeighbors = order ? Array.sort(neighbors, order) : neighbors
            for (let i = sortedNeighbors.length - 1; i >= 0; i--) {
              const neighbor = sortedNeighbors[i]
              if (!discovered.has(neighbor)) {
                stack.push(neighbor)
              }
            }
          }

          return { done: false, value: f(current, nodeDataOption) }
        }

        return { done: true, value: undefined } as const
      }

      return { next: nextMapped }
    }
  }))
}
