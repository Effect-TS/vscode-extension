import * as ConfigAsExtWebView from "@effect/devtools-shared/ConfigAsExtWebView"
import * as ExtWhenEvaluator from "@effect/devtools-shared/core/ExtWhenEvaluator"
import { Commands, LiveCommonCapabilities, TreeViews, WebViews } from "@effect/devtools-shared/extension"
import * as ExtTreeAsExtWebView from "@effect/devtools-shared/ExtTreeAsExtWebView"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Contribs from "./ChromeExtHost.ts"
import * as ChromeExtHostDebugger from "./ChromeExtHostDebugger.ts"

const ActivateDebugClientDefault = Layer.effectDiscard(Effect.gen(function*() {
  yield* Commands.AttachDebugSessionClient.execute()
}))

const ChromeExtension = Layer.mergeAll(
  // behaviour
  ActivateDebugClientDefault,
  // clients
  Contribs.treeView(TreeViews.ClientsTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientsTree, Commands.AttachDebugSessionClient),
  // tracer
  Contribs.treeView(TreeViews.ClientSpanTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientSpanTree, Commands.ResetTracer),
  // metrics
  Contribs.treeView(TreeViews.ClientMetricsTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientMetricsTree, Commands.ResetMetrics),
  // extended tracer
  Contribs.webView(WebViews.ClientTracer, "effect-tracer-panel"),
  Contribs.webViewNavigationAction(WebViews.ClientTracer, Commands.ResetTracerExtended),
  // breakpoints
  Contribs.treeView(TreeViews.DebugBreakpointsTree, "debug"),
  // context
  Contribs.treeView(TreeViews.DebugContextTree, "debug"),
  Contribs.treeViewNavigationAction(TreeViews.DebugContextTree, Commands.RefreshDebugContext),
  // fibers
  Contribs.treeView(TreeViews.DebugFibersTree, "debug"),
  Contribs.treeViewNavigationAction(TreeViews.DebugFibersTree, Commands.RefreshDebugFibers),
  Contribs.treeViewInlineAction(TreeViews.DebugFibersTree, Commands.InterruptDebugFiber)("FiberId"),
  Contribs.treeViewInlineAction(TreeViews.DebugFibersTree, Commands.RevealFiberCurrentSpan)("FiberId"),
  // span stack
  Contribs.treeView(TreeViews.DebugSpanStackTree, "debug"),
  Contribs.treeViewNavigationAction(TreeViews.DebugSpanStackTree, Commands.RefreshDebugSpanStack),
  Contribs.treeViewNavigationAction(TreeViews.DebugSpanStackTree, Commands.EnableSpanStackIgnoreList),
  Contribs.treeViewNavigationAction(TreeViews.DebugSpanStackTree, Commands.DisableSpanStackIgnoreList),
  Contribs.treeViewInlineAction(TreeViews.DebugSpanStackTree, Commands.RevealSpanLocation)("SpanNode"),
  // config
  Contribs.webView(ConfigAsExtWebView.WebView, "effect-config")
).pipe(
  Layer.provideMerge(LiveCommonCapabilities),
  Layer.provide(ExtTreeAsExtWebView.layer),
  Layer.provide(Contribs.ChromeExtHost),
  Layer.provideMerge(ChromeExtHostDebugger.ChromeExtHostDebugger),
  Layer.provide(ExtWhenEvaluator.ExtWhenEvaluator.Default),
  Layer.provideMerge(Contribs.CurrentContributes.Live)
)

const program = Contribs.launch.pipe(
  Layer.provide(ChromeExtension),
  Layer.launch
)

Effect.runPromise(program)
