import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import * as ExtHostDebugger from "@effect/devtools-shared/core/ExtHostDebugger"
import {
  Commands,
  Configs,
  LiveCommonCapabilities,
  LiveServerCapabilities,
  TreeViews,
  WebViews
} from "@effect/devtools-shared/extension"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Contribs from "./VscodeContributesExtHost.ts"

export const VscodeExtension = Layer.mergeAll(
  // clients
  Contribs.treeView(TreeViews.ClientsTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientsTree, Commands.StartServer),
  Contribs.treeViewNavigationAction(TreeViews.ClientsTree, Commands.StopServer),
  Contribs.treeViewNavigationAction(TreeViews.ClientsTree, Commands.AttachDebugSessionClient),
  // metrics
  Contribs.treeView(TreeViews.ClientMetricsTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientMetricsTree, Commands.ResetMetrics),
  // tracer
  Contribs.treeView(TreeViews.ClientSpanTree, "effect"),
  Contribs.treeViewNavigationAction(TreeViews.ClientSpanTree, Commands.ResetTracer),
  // extended tracer
  Contribs.webView(WebViews.ClientTracer, "effect-tracer-panel"),
  Contribs.webViewNavigationAction(WebViews.ClientTracer, Commands.ResetTracerExtended),
  // breakpoints
  Contribs.treeView(TreeViews.DebugBreakpointsTree, "debug"),
  // context
  Contribs.treeView(TreeViews.DebugContextTree, "debug"),
  // fibers
  Contribs.treeView(TreeViews.DebugFibersTree, "debug"),
  Contribs.treeViewInlineAction(TreeViews.DebugFibersTree, Commands.InterruptDebugFiber)("FiberId"),
  Contribs.treeViewInlineAction(TreeViews.DebugFibersTree, Commands.RevealFiberCurrentSpan)("FiberId"),
  // span stack
  Contribs.treeView(TreeViews.DebugSpanStackTree, "debug"),
  Contribs.treeViewNavigationAction(TreeViews.DebugSpanStackTree, Commands.EnableSpanStackIgnoreList),
  Contribs.treeViewNavigationAction(TreeViews.DebugSpanStackTree, Commands.DisableSpanStackIgnoreList),
  Contribs.treeViewInlineAction(TreeViews.DebugSpanStackTree, Commands.RevealSpanLocation)("SpanNode")
).pipe(
  Layer.provideMerge(LiveServerCapabilities),
  Layer.provideMerge(LiveCommonCapabilities),
  Layer.provideMerge(Layer.mergeAll(
    ExtHost.registerConfig(Configs.DevServerPort),
    ExtHost.registerConfig(Configs.InstrumentationInjectDebugConfigurations),
    ExtHost.registerConfig(Configs.InstrumentationInjectNodeOptions)
  ))
)

export const InitialContributes = Contribs.initial({
  extensionTitle: "Effect Dev Tools",
  viewsWelcome: [
    {
      view: "effect-clients",
      contents: "The Effect Dev Tools server is currently stopped.\n[Start the server](command:effect.startServer)"
    }
  ],
  viewsContainers: {
    activitybar: [
      {
        id: "effect",
        title: "Effect Dev Tools",
        icon: "resources/icons/effect-light.svg"
      }
    ],
    panel: [
      {
        id: "effect-tracer-panel",
        title: "Effect Tracer",
        icon: "resources/icons/effect-light.svg"
      }
    ]
  }
})

const MainLive = VscodeExtension.pipe(
  Layer.provide(ExtHostDebugger.ExtHostDebugger.Mock),
  Layer.provide(Contribs.VscodeContributesExtHost),
  Layer.provideMerge(InitialContributes)
)

export const getContributesObject = Contribs.getContributes.pipe(
  Effect.provide(MainLive)
)
