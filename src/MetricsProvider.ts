import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Schedule from "effect/Schedule"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as vscode from "vscode"
import { Client, Clients } from "./Clients"
import {
  TreeDataProvider,
  configWithDefault,
  registerCommand,
  treeDataProvider,
} from "./VsCode"

const MetricOrder = Order.make<Domain.Metric>(
  Order.struct({
    name: Order.string,
  }),
)

class MetricNode {
  readonly _tag = "MetricNode"
  constructor(readonly metric: Domain.Metric) {}

  get tagsWithoutUnit() {
    return this.metric.tags.filter(
      _ => _.key !== "unit" && _.key !== "time_unit",
    )
  }

  get unitSuffix() {
    const tag = this.metric.tags.find(
      _ => _.key === "unit" || _.key === "time_unit",
    )
    return tag ? ` ${tag.value}` : ""
  }
}

class InfoNode {
  readonly _tag = "InfoNode"
  constructor(
    readonly key: string,
    readonly value: string,
  ) {}
}

type TreeNode = MetricNode | InfoNode

export const MetricsProviderLive = treeDataProvider<TreeNode>("effect-metrics")(
  refresh =>
    Effect.gen(function* () {
      const clients = yield* Clients
      let nodes: Array<MetricNode> = []
      const pollMillis = yield* configWithDefault(
        "effect.metrics",
        "pollInterval",
        500,
      )
      const currentClient = yield* ScopedRef.make<void>(() => void 0)

      const reset = Effect.gen(function* () {
        yield* ScopedRef.set(currentClient, Effect.void)
        nodes = []
        return yield* refresh(Option.none())
      })

      yield* clients.activeClient.changes.pipe(
        Stream.changes,
        Stream.tap(_ => (Option.isSome(_) ? reset : Effect.void)),
        Stream.runForEach(_ =>
          Option.match(_, {
            onNone: () => Effect.void,
            onSome: client =>
              ScopedRef.set(
                currentClient,
                Effect.interruptible(handleClient(client)),
              ),
          }),
        ),
        Effect.forkScoped,
      )

      yield* registerCommand("effect.resetMetrics", () => reset)

      const handleClient = (client: Client) =>
        Effect.gen(function* () {
          yield* client.metrics.take.pipe(
            Effect.flatMap(snapshot =>
              Effect.suspend(() => {
                const metrics = snapshot.metrics as Array<Domain.Metric>
                const names = new Set<string>()
                metrics.sort(MetricOrder)
                nodes = Array.filterMap(metrics, metric => {
                  const name = metric.name
                  if (names.has(name)) {
                    return Option.none()
                  }
                  names.add(name)
                  return Option.some(new MetricNode(metric))
                })
                return refresh(Option.none())
              }),
            ),
            Effect.forever,
            Effect.forkScoped,
          )

          yield* pollMillis.changes.pipe(
            Stream.flatMap(
              millis =>
                client.requestMetrics.pipe(
                  Effect.repeat(Schedule.spaced(millis)),
                ),
              { switch: true },
            ),
            Stream.runDrain,
            Effect.forkScoped,
          )
        })

      return TreeDataProvider<TreeNode>({
        children: Option.match({
          onNone: () => Effect.succeedSome(nodes),
          onSome: node => Effect.succeed(children(node)),
        }),
        treeItem: node => Effect.succeed(treeItem(node)),
      })
    }),
).pipe(Layer.provide(Clients.Live))

// === helpers ===

const formatNumber = (value: number): string =>
  (Math.round(value * 100) / 100).toLocaleString()

const children = (node: TreeNode): Option.Option<Array<TreeNode>> => {
  switch (node._tag) {
    case "MetricNode": {
      const metric = node.metric
      const nodes: Array<InfoNode> = node.tagsWithoutUnit.map(
        tag => new InfoNode(tag.key, tag.value),
      )
      switch (metric._tag) {
        case "Frequency": {
          const unit = node.unitSuffix
          const entries = Object.entries(metric.state.occurrences)
          entries.sort(([a], [b]) => a.localeCompare(b))
          for (let i = 0, len = entries.length; i < len; i++) {
            const [key, value] = entries[i]
            nodes.push(new InfoNode(key, String(value) + unit))
          }
          break
        }
        case "Histogram": {
          const unit = node.unitSuffix
          nodes.push(new InfoNode("Count", String(metric.state.count)))
          nodes.push(new InfoNode("Sum", formatNumber(metric.state.sum) + unit))
          nodes.push(new InfoNode("Min", formatNumber(metric.state.min) + unit))
          nodes.push(new InfoNode("Max", formatNumber(metric.state.max) + unit))
          break
        }
        case "Summary": {
          const unit = node.unitSuffix
          for (let i = 0, len = metric.state.quantiles.length; i < len; i++) {
            const [quantile, valueOption] = metric.state.quantiles[i]
            const value = valueOption._tag === "Some" ? valueOption.value : 0
            nodes.push(
              new InfoNode(`p${quantile * 100}`, formatNumber(value) + unit),
            )
          }
          nodes.push(new InfoNode("Count", String(metric.state.count)))
          nodes.push(new InfoNode("Sum", formatNumber(metric.state.sum) + unit))
          nodes.push(new InfoNode("Min", formatNumber(metric.state.min) + unit))
          nodes.push(new InfoNode("Max", formatNumber(metric.state.max) + unit))
        }
      }
      return Option.some(nodes)
    }
    case "InfoNode": {
      return Option.none()
    }
  }
}

const treeItem = (node: TreeNode): vscode.TreeItem => {
  switch (node._tag) {
    case "MetricNode": {
      const metric = node.metric
      const tags = node.tagsWithoutUnit
      const item = new vscode.TreeItem(
        metric.name,
        tags.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      )
      item.id = metric.name

      if (metric._tag === "Counter") {
        item.description = String(metric.state.count) + node.unitSuffix
      } else if (metric._tag === "Gauge") {
        item.description = String(metric.state.value) + node.unitSuffix
      } else if (metric._tag === "Histogram") {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
        let previous = 0
        let previousAcc: number | undefined
        let multiplied = 0
        for (let i = 0, len = metric.state.buckets.length; i < len; i++) {
          const [bucket, acc] = metric.state.buckets[i]
          if (!Number.isFinite(bucket)) {
            break
          }
          const count = previousAcc === undefined ? acc : acc - previousAcc
          const mid = (bucket + previous) / 2
          multiplied += mid * count
          previous = bucket
          previousAcc = acc
        }
        const mean = multiplied / metric.state.count
        item.description = formatNumber(mean) + node.unitSuffix + " (mean)"
      } else if (metric._tag === "Frequency") {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
      } else if (metric._tag === "Summary") {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
        const mid = Math.ceil(metric.state.quantiles.length / 2)
        const [quantile, valueOption] = metric.state.quantiles[mid]
        const value = valueOption._tag === "Some" ? valueOption.value : 0
        item.description = `${formatNumber(value)}${node.unitSuffix} (p${
          quantile * 100
        })`
      }

      return item
    }
    case "InfoNode": {
      const item = new vscode.TreeItem(
        node.key,
        vscode.TreeItemCollapsibleState.None,
      )
      item.description = node.value
      item.tooltip = node.value
      item.contextValue = "info"
      return item
    }
  }
}
