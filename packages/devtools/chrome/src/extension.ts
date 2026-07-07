import * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import * as DevtoolClients from "@effect/devtools-shared/DevtoolClients"
import { Commands, Configs, LiveCommonCapabilities, TreeViews, WebViews } from "@effect/devtools-shared/extension"
import * as ConfigAsExtWebView from "@effect/devtools-shared/replacements/ConfigAsExtWebView"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Contribs from "./ChromeExtHost.ts"
import * as ChromeExtHostDebugger from "./ChromeExtHostDebugger.ts"

const ChromeExtension = Layer.mergeAll(
  // clients
  Contribs.treeView(TreeViews.ClientsTree, "effect"),
  ExtTreeView.treeViewNavigationAction(TreeViews.ClientsTree, Commands.AttachDebugSessionClient),
  // tracer
  Contribs.treeView(TreeViews.ClientSpanTree, "effect"),
  // metrics
  Contribs.treeView(TreeViews.ClientMetricsTree, "effect"),
  // extended tracer
  Contribs.webView(WebViews.ClientTracer, "effect-tracer-panel"),
  // breakpoints
  Contribs.treeView(TreeViews.DebugBreakpointsTree, "debug"),
  // context
  Contribs.treeView(TreeViews.DebugContextTree, "debug"),
  // fibers
  Contribs.treeView(TreeViews.DebugFibersTree, "debug"),
  // span stack
  Contribs.treeView(TreeViews.DebugSpanStackTree, "debug"),
  // config
  Contribs.webView(ConfigAsExtWebView.WebView, "effect-config")
).pipe(
  Layer.provideMerge(LiveCommonCapabilities),
  Layer.provide(DevtoolClients.layerSpanCollector),
  Layer.provideMerge(DevtoolClients.DevtoolClients.Default),
  Layer.provideMerge(ChromeExtHostDebugger.ChromeExtHostDebugger),
  Layer.provideMerge(Configs.SpanStackIgnoreList.toLayer()),
  Layer.provideMerge(Configs.TracerPollInterval.toLayer()),
  Layer.provideMerge(Configs.MetricsPollInterval.toLayer()),
  Layer.provideMerge(Contribs.layer)
)

const program = Contribs.launch.pipe(
  Layer.provide(ChromeExtension),
  Layer.launch
)

Effect.runPromise(program)
