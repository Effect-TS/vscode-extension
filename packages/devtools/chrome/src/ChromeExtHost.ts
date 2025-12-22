import * as ExtCommand from "@effect/devtools-shared/core/ExtCommand"
import * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import * as ExtTextEditor from "@effect/devtools-shared/core/ExtTextEditor"
import type * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import * as ExtWhenClause from "@effect/devtools-shared/core/ExtWhenClause"
import * as ExtWorkspace from "@effect/devtools-shared/core/ExtWorkspace"
import * as ConfigAsExtWebView from "@effect/devtools-shared/replacements/ConfigAsExtWebView"
import * as ExtTreeAsExtWebView from "@effect/devtools-shared/replacements/ExtTreeAsExtWebView"
import * as ContainerWebViewHtml from "@effect/devtools-shared/webviews/container.generated"
import { PubSub, Stream } from "effect"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"

const configurationPage = Layer.unwrapScoped(Effect.gen(function*() {
  const configChanges = yield* PubSub.sliding<{ config: ExtConfig.AnyWithProps; value: any }>(2)

  const readConfig = (config: ExtConfig.AnyWithProps) => {
    return Effect.gen(function*() {
      const get = Effect.tryPromise(() => chrome.storage.local.get(config._id)).pipe(
        Effect.flatMap((_) => Schema.decodeUnknown(config.schema)(_[config._id])),
        Effect.catchAllCause(() => Effect.succeed(config.defaultValue))
      )
      return {
        get,
        changes: Stream.fromEffect(get).pipe(
          Stream.concat(
            Stream.fromPubSub(configChanges).pipe(
              Stream.filter((_) => _.config._id === config._id),
              Stream.map((_) => _.value)
            )
          )
        )
      }
    })
  }

  return ConfigAsExtWebView.layer((config, value) =>
    Schema.encodeUnknown(config.schema)(value).pipe(
      Effect.flatMap((encoded) => Effect.sync(() => chrome.storage.local.set({ [config._id]: encoded }))),
      Effect.zipRight(PubSub.publish(configChanges, { config, value })),
      Effect.ignoreLogged
    )
  ).pipe(
    Layer.provideMerge(Layer.succeed(ExtConfig.ExtConfigHostCapability, {
      registerConfig: () => Effect.void,
      readConfig
    }))
  )
}))

const sourcesWorkspace = Layer.succeed(ExtTextEditor.ExtTextEditorHostCapability, {
  revealFileLineColumnRange: (path, line, column) =>
    Effect.sync(() => chrome.devtools.panels.openResource(path, line, column))
})

export class CurrentContributes
  extends Context.Tag("effect-chrome/ChromeExtHost/CurrentContributes")<CurrentContributes, {
    viewToContainer: Map<string, string>
    effectWebViews: Array<
      {
        webView: ExtWebView.AnyWithProps
        builder: ExtWebView.ExtWebViewBuilder<Scope.Scope>
        position: "side" | "main"
      }
    >
    initializers: Array<Effect.Effect<void, never, Scope.Scope>>
    sidebarPanes: Map<string, chrome.devtools.panels.ExtensionSidebarPane>
  }>()
{
  static Live = Layer.sync(this, () => ({
    viewToContainer: new Map(),
    initializers: [],
    effectWebViews: [],
    sidebarPanes: new Map()
  }))
}

const createWebViewBooter = (
  _webView: ExtWebView.AnyWithProps,
  _builder: ExtWebView.ExtWebViewBuilder<Scope.Scope>,
  _sendInitialize: (w: Window, port: MessagePort) => Effect.Effect<void, never, Scope.Scope>
) => {
  return Effect.gen(function*() {
    // we always want the webview to send the first message to the extension (to make sure its up and running)
    const booted = yield* Deferred.make<void>()
    let hasBooted = false
    yield* Deferred.await(booted).pipe(Effect.flatMap(() => _builder(request, events)), Effect.forkScoped)

    // messaging
    const events = yield* Mailbox.make<unknown>()

    // we need to ensure the webview is visible, otherwise we'll get very bad times
    let port1: MessagePort | undefined = undefined
    const request = (message: unknown) =>
      Effect.sync(() => {
        if (port1) {
          port1.postMessage(message)
        }
      })

    // create the send port onShown handler
    const runtime = yield* Effect.runtime<Scope.Scope>()
    const onShown = (_: Window) => {
      const channel = new MessageChannel()
      port1 = channel.port1
      channel.port1.onmessage = (event) => {
        if (!hasBooted) {
          hasBooted = true
          Deferred.unsafeDone(booted, Effect.void)
        }
        events.unsafeOffer(event.data)
      }
      Runtime.runCallback(runtime)(_sendInitialize(_, channel.port2))
    }
    const onHidden = () => {
      port1 = undefined
    }
    return { onShown, onHidden }
  })
}

const webViewCapability = Layer.unwrapEffect(Effect.gen(function*() {
  const contributes = yield* CurrentContributes

  return Layer.succeed(ExtWebView.ExtWebViewHostCapability, {
    registerWebView: (_webView, _builder) => {
      const registration = Effect.gen(function*() {
        // check if already registered
        const existing = contributes.sidebarPanes.get(_webView._id)
        if (existing) return

        // get the target section
        const targetSection = contributes.viewToContainer.get(_webView._id) || "effect"
        let section: chrome.devtools.panels.SourcesPanel | chrome.devtools.panels.ElementsPanel | undefined = undefined
        if (targetSection === "debug") {
          section = chrome.devtools.panels.sources || chrome.devtools.panels.elements
        }

        // exit if this wants to go to a panel
        if (!section) {
          contributes.effectWebViews.push({
            webView: _webView,
            builder: _builder,
            position: targetSection === "effect" ? "side" : "main"
          })
          return
        }

        // start the webview booter
        const { onHidden, onShown } = yield* createWebViewBooter(
          _webView,
          _builder,
          (_, port2) => Effect.sync(() => _.postMessage("", "*", [port2]))
        )
        section.createSidebarPane(_webView.title, (sidebar) => {
          contributes.sidebarPanes.set(_webView._id, sidebar)
          sidebar.setHeight("300px")
          sidebar.setPage(chrome.runtime.getURL(`ui-${_webView.type}.html`))
          sidebar.onHidden.addListener(onHidden)
          sidebar.onShown.addListener(onShown)
        })
      })

      return Effect.sync(() => contributes.initializers.push(registration))
    }
  })
}))

export const layer = Layer.empty.pipe(
  Layer.provideMerge(ExtTreeAsExtWebView.layer),
  Layer.provideMerge(configurationPage),
  Layer.provideMerge(webViewCapability),
  Layer.provideMerge(ExtCommand.layerInMemory),
  Layer.provideMerge(ExtWorkspace.layerAsIs),
  Layer.provideMerge(sourcesWorkspace),
  Layer.provideMerge(ExtWhenClause.layerInMemoryEvaluator),
  Layer.provideMerge(ExtWhenClause.ExtWhenEvaluator.Default),
  Layer.provideMerge(CurrentContributes.Live)
)

export const launch = Layer.scopedDiscard(Effect.gen(function*() {
  const contributes = yield* CurrentContributes
  yield* Effect.all(contributes.initializers)

  // loop and initialize the effect webviews
  const onShowListeners: Array<(_: Window) => void> = []
  const onHiddenListeners: Array<() => void> = []
  for (const { builder, position, webView } of contributes.effectWebViews) {
    const initializePanelMessage = yield* Schema.encodeUnknown(ContainerWebViewHtml.InitializePanel)(
      new ContainerWebViewHtml.InitializePanel({
        id: webView._id,
        title: webView.title,
        position,
        page: chrome.runtime.getURL(`ui-${webView.type}.html`)
      })
    )
    const { onHidden, onShown } = yield* createWebViewBooter(
      webView,
      builder,
      (w, port2) => Effect.sync(() => w.postMessage(initializePanelMessage, "*", [port2]))
    )
    onShowListeners.push(onShown)
    onHiddenListeners.push(onHidden)
  }
  chrome.devtools.panels.create("Effect", "", "ui-container.html", (panel) => {
    panel.onHidden.addListener(() => onHiddenListeners.forEach((onHidden) => onHidden()))
    panel.onShown.addListener((w) => onShowListeners.forEach((onShown) => onShown(w)))
  })
}))

export function treeView<V extends ExtTreeView.Any>(
  treeView: V,
  section: string
): Layer.Layer<never, never, CurrentContributes | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>>> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
    contributes.viewToContainer.set(treeView._id, section)
  }))
}

export function webView<V extends ExtWebView.Any>(
  webView: V,
  section: string
): Layer.Layer<never, never, CurrentContributes | ExtWebView.UnknownWebView<ExtWebView.Id<V>>> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
    contributes.viewToContainer.set(webView._id, section)
  }))
}
