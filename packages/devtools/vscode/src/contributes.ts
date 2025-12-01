import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import * as ExtHostDebugger from "@effect/devtools-shared/core/ExtHostDebugger"
import * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
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
  ExtTreeView.treeViewNavigationAction(TreeViews.ClientsTree, Commands.AttachDebugSessionClient),
  // metrics
  Contribs.treeView(TreeViews.ClientMetricsTree, "effect"),
  // tracer
  Contribs.treeView(TreeViews.ClientSpanTree, "effect"),
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
  Contribs.treeView(TreeViews.DebugSpanStackTree, "debug")
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

export const getContributesObject = Contribs.getContributes.pipe(
  Effect.provide(VscodeExtension.pipe(
    Layer.provide(ExtHostDebugger.ExtHostDebugger.Mock),
    Layer.provide(Contribs.VscodeContributesExtHost),
    Layer.provideMerge(InitialContributes)
  ))
)
