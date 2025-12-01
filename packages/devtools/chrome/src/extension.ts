import * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import * as ExtWhenEvaluator from "@effect/devtools-shared/core/ExtWhenEvaluator"
import { Commands, LiveCommonCapabilities, TreeViews, WebViews } from "@effect/devtools-shared/extension"
import * as ConfigAsExtWebView from "@effect/devtools-shared/replacements/ConfigAsExtWebView"
import * as ExtTreeAsExtWebView from "@effect/devtools-shared/replacements/ExtTreeAsExtWebView"
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
  ExtTreeView.treeViewNavigationAction(TreeViews.ClientsTree, Commands.AttachDebugSessionClient),
  // tracer
  Contribs.treeView(TreeViews.ClientSpanTree, "effect"),
  // metrics
  Contribs.treeView(TreeViews.ClientMetricsTree, "effect"),
  // extended tracer
  Contribs.webView(WebViews.ClientTracer, "effect-tracer-panel"),
  Contribs.webViewNavigationAction(WebViews.ClientTracer, Commands.ResetTracerExtended),
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
