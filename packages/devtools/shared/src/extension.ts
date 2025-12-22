import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { ClientMetricsTree, ClientMetricsTreeViewLive } from "./ClientMetricsTreeView.ts"
import { ClientsCommandsLive } from "./ClientsCommands.ts"
import { ClientSpanTree, ClientSpanTreeViewLive } from "./ClientSpanTreeView.ts"
import { ClientsTree, ClientsTreeViewLive } from "./ClientsTreeView.ts"
import { ClientTracerWebView, ClientTracerWebViewLive } from "./ClientTracerWebView.ts"
import * as ExtHostDebugger from "./core/ExtHostDebugger.ts"
import * as ExtTreeView from "./core/ExtTreeView.ts"
import { DebugBreakpointsTree, DebugBreakpointsTreeViewLive } from "./DebugBreakpointsTreeView.ts"
import { DebugContextTree, DebugContextTreeViewLive } from "./DebugContextTreeView.ts"
import { DebugFibersTree, DebugFibersTreeViewLive } from "./DebugFibersTreeView.ts"
import { DebugSpanStackTree, DebugSpanStackTreeViewLive } from "./DebugSpanStackTreeView.ts"
import * as DevtoolClients from "./DevtoolClients.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as DevtoolConfigs from "./DevtoolConfigs.ts"
import * as DevtoolDebugBridge from "./DevtoolDebugBridge.ts"
import * as DevtoolInputs from "./DevtoolInputs.ts"
import { ServerCommandsLive } from "./ServerCommands.ts"

const SetHasDebugTargets = Layer.scopedDiscard(Effect.gen(function*() {
  const hostDebugger = yield* ExtHostDebugger.ExtHostDebugger
  const hasDebugTargets = yield* DevtoolInputs.hasDebugTargets

  yield* hostDebugger.connections.changes.pipe(
    Stream.mapEffect((connections) => hasDebugTargets(connections.length > 0)),
    Stream.runDrain,
    Effect.forkScoped
  )
}))

const SetInDebugMode = Layer.scopedDiscard(Effect.gen(function*() {
  const hostDebugger = yield* ExtHostDebugger.ExtHostDebugger
  const inDebugMode = yield* DevtoolInputs.inDebugMode

  yield* hostDebugger.activeConnection.changes.pipe(
    Stream.mapEffect((connection) => inDebugMode(Option.isSome(connection))),
    Stream.runDrain,
    Effect.forkScoped
  )
}))

export const LiveServerCapabilities = Layer.mergeAll(
  ExtTreeView.treeViewNavigationAction(ClientsTree, DevtoolCommands.StartServer),
  ExtTreeView.treeViewNavigationAction(ClientsTree, DevtoolCommands.StopServer)
).pipe(
  Layer.provideMerge(ServerCommandsLive)
)

export const LiveCommonCapabilities = Layer.mergeAll(
  DebugFibersTreeViewLive,
  DebugContextTreeViewLive,
  DebugSpanStackTreeViewLive,
  DebugBreakpointsTreeViewLive,
  ClientsTreeViewLive,
  ClientsCommandsLive,
  ClientMetricsTreeViewLive,
  ClientSpanTreeViewLive,
  ClientTracerWebViewLive,
  SetHasDebugTargets,
  SetInDebugMode
).pipe(
  Layer.provide(DevtoolClients.layerSpanCollector),
  Layer.provideMerge(DevtoolClients.DevtoolClients.Default),
  Layer.provideMerge(DevtoolDebugBridge.DevtoolDebugBridge.Default),
  Layer.provideMerge(Layer.mergeAll(
    DevtoolInputs.inDebugMode.layerDefault(false),
    DevtoolInputs.running.layerDefault(false),
    DevtoolInputs.hasClients.layerDefault(false),
    DevtoolInputs.spanStackIgnoreListEnabled.layerDefault(false),
    DevtoolInputs.hasDebugTargets.layerDefault(false)
  ))
)

export const TreeViews = {
  ClientMetricsTree,
  ClientSpanTree,
  ClientsTree,
  DebugBreakpointsTree,
  DebugContextTree,
  DebugFibersTree,
  DebugSpanStackTree
}

export const WebViews = {
  ClientTracer: ClientTracerWebView
}

export const Commands = DevtoolCommands

export const Configs = DevtoolConfigs
