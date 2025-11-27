import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Schedule from "effect/Schedule"
import * as ScopedRef from "effect/ScopedRef"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import * as Clients from "./DevtoolClients.ts"
import * as Commands from "./DevtoolCommands.ts"
import * as Configs from "./DevtoolConfigs.ts"

const MetricOrder = Order.make<Domain.Metric>(
  Order.struct({
    name: Order.string
  })
)

const formatNumber = (value: number): string => (Math.round(value * 100) / 100).toLocaleString()

class MetricNode extends Data.TaggedClass("MetricNode")<{
  metric: Domain.Metric
}> {
  get tagsWithoutUnit() {
    return this.metric.tags.filter(
      (_) => _.key !== "unit" && _.key !== "time_unit"
    )
  }

  get unitSuffix() {
    const tag = this.metric.tags.find(
      (_) => _.key === "unit" || _.key === "time_unit"
    )
    return tag ? ` ${tag.value}` : ""
  }

  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    const metric = this.metric
    const nodes: Array<InfoNode> = this.tagsWithoutUnit.map(
      (tag) => new InfoNode({ metric, key: tag.key, value: tag.value })
    )

    switch (metric._tag) {
      case "Frequency": {
        const unit = this.unitSuffix
        const entries = Object.entries(metric.state.occurrences)
        entries.sort(([a], [b]) => a.localeCompare(b))
        for (let i = 0, len = entries.length; i < len; i++) {
          const [key, value] = entries[i]
          nodes.push(new InfoNode({ metric, key, value: String(value) + unit }))
        }
        break
      }
      case "Histogram": {
        const unit = this.unitSuffix
        nodes.push(new InfoNode({ metric, key: "Count", value: String(metric.state.count) }))
        nodes.push(new InfoNode({ metric, key: "Sum", value: formatNumber(metric.state.sum) + unit }))
        nodes.push(new InfoNode({ metric, key: "Min", value: formatNumber(metric.state.min) + unit }))
        nodes.push(new InfoNode({ metric, key: "Max", value: formatNumber(metric.state.max) + unit }))
        break
      }
      case "Summary": {
        const unit = this.unitSuffix
        for (let i = 0, len = metric.state.quantiles.length; i < len; i++) {
          const [quantile, valueOption] = metric.state.quantiles[i]
          const value = valueOption._tag === "Some" ? valueOption.value : 0
          nodes.push(
            new InfoNode({ metric, key: `p${quantile * 100}`, value: formatNumber(value) + unit })
          )
        }
        nodes.push(new InfoNode({ metric, key: "Count", value: String(metric.state.count) }))
        nodes.push(new InfoNode({ metric, key: "Sum", value: formatNumber(metric.state.sum) + unit }))
        nodes.push(new InfoNode({ metric, key: "Min", value: formatNumber(metric.state.min) + unit }))
        nodes.push(new InfoNode({ metric, key: "Max", value: formatNumber(metric.state.max) + unit }))
        break
      }
    }

    return Effect.succeedSome(nodes)
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    const metric = this.metric
    const tags = this.tagsWithoutUnit

    let description: string | undefined = undefined
    let collapsibleState: "none" | "collapsed" | "expanded" = tags.length > 0 ? "collapsed" : "none"

    if (metric._tag === "Counter") {
      description = String(metric.state.count) + this.unitSuffix
    } else if (metric._tag === "Gauge") {
      description = String(metric.state.value) + this.unitSuffix
    } else if (metric._tag === "Histogram") {
      collapsibleState = "collapsed"
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
      description = formatNumber(mean) + this.unitSuffix + " (mean)"
    } else if (metric._tag === "Frequency") {
      collapsibleState = "expanded"
    } else if (metric._tag === "Summary") {
      collapsibleState = "collapsed"
      const mid = Math.ceil(metric.state.quantiles.length / 2)
      const [quantile, valueOption] = metric.state.quantiles[mid]
      const value = valueOption._tag === "Some" ? valueOption.value : 0
      description = `${formatNumber(value)}${this.unitSuffix} (p${quantile * 100})`
    }

    return Effect.succeed({
      id: metric.name,
      label: metric.name,
      description: description ?? "",
      collapsibleState
    })
  }
}

class InfoNode extends Data.TaggedClass("InfoNode")<{
  metric: Domain.Metric
  key: string
  value: string
}> {
  children(): Effect.Effect<Option.Option<Array<TreeNode>>> {
    return Effect.succeedNone
  }

  treeItem(): Effect.Effect<ExtTreeView.ExtTreeViewItem> {
    return Effect.succeed({
      id: [this.metric.name, this.key].join("/"),
      label: this.key,
      description: this.value,
      tooltip: this.value,
      collapsibleState: "none" as const
    })
  }
}

type TreeNode = MetricNode | InfoNode

export const ClientMetricsTree = ExtTreeView.make<TreeNode>()("effect-metrics", {
  title: "Metrics"
})

export const ClientMetricsTreeViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const clients = yield* Clients.DevtoolClients
  const nodesRef = yield* SubscriptionRef.make<Array<MetricNode>>([])
  const pollMillis = yield* Configs.MetricsPollInterval

  const currentClient = yield* ScopedRef.make<void>(() => void 0)

  const reset = SubscriptionRef.set(nodesRef, [])

  const handleClient = (client: Clients.Client) =>
    Effect.gen(function*() {
      const metrics = yield* client.metrics
      yield* metrics.take.pipe(
        Effect.flatMap((snapshot) => {
          const metrics = snapshot.metrics as Array<Domain.Metric>
          const names = new Set<string>()
          metrics.sort(MetricOrder)
          const nodes = Array.filterMap(metrics, (metric) => {
            const name = metric.name
            if (names.has(name)) {
              return Option.none()
            }
            names.add(name)
            return Option.some(new MetricNode({ metric }))
          })
          return SubscriptionRef.set(nodesRef, nodes)
        }),
        Effect.forever,
        Effect.scoped,
        Effect.forkScoped
      )

      yield* pollMillis.changes.pipe(
        Stream.flatMap(
          (millis) =>
            client.requestMetrics.pipe(
              Effect.repeat(Schedule.spaced(millis))
            ),
          { switch: true }
        ),
        Stream.runDrain,
        Effect.forkScoped
      )
    })

  yield* clients.activeClient.changes.pipe(
    Stream.changes,
    Stream.tap((_) => (Option.isSome(_) ? reset : Effect.void)),
    Stream.runForEach((_) =>
      Option.match(_, {
        onNone: () =>
          ScopedRef.set(
            currentClient,
            Effect.void
          ),
        onSome: (client) =>
          ScopedRef.set(
            currentClient,
            Effect.interruptible(handleClient(client))
          )
      })
    ),
    Effect.forkScoped
  )

  const treeViewProvider = ClientMetricsTree.toLayer((refresh) =>
    Effect.gen(function*() {
      // refresh the tree view when nodes change
      yield* nodesRef.changes.pipe(
        Stream.runForEach(() => refresh(Option.none())),
        Effect.forkScoped
      )

      return {
        treeItem: (element) => element.treeItem(),
        children: Option.match({
          onNone: () => SubscriptionRef.get(nodesRef).pipe(Effect.map(Option.some)),
          onSome: (node) => node.children()
        })
      }
    })
  )

  const resetMetrics = Commands.ResetMetrics.toLayer(
    Effect.succeed(() => reset.pipe(Effect.ignoreLogged))
  )

  return treeViewProvider.pipe(
    Layer.provideMerge(resetMetrics)
  )
}))
