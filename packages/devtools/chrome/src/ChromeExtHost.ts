import type * as ExtCommand from "@effect/devtools-shared/core/ExtCommand"
import type * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import type * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import type * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import * as ExtWhenEvaluator from "@effect/devtools-shared/core/ExtWhenEvaluator"
import * as ContainerWebViewHtml from "@effect/devtools-shared/webviews/container.generated"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtTreeAsExtWebView from "./ExtTreeAsExtWebView.ts"

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
  static Live = Layer.succeed(this, {
    viewToContainer: new Map(),
    initializers: [],
    effectWebViews: [],
    sidebarPanes: new Map()
  })
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
          console.log(_webView._id, "->", message)
          port1.postMessage(message)
        }
      })

    // create the send port onShown handler
    const runtime = yield* Effect.runtime<Scope.Scope>()
    const onShown = (_: Window) => {
      console.log("onShown", _webView._id)
      const channel = new MessageChannel()
      port1 = channel.port1
      channel.port1.onmessage = (event) => {
        if (!hasBooted) {
          hasBooted = true
          Deferred.unsafeDone(booted, Effect.void)
        }
        console.log(_webView._id, "<-", event.data)
        events.unsafeOffer(event.data)
      }
      Runtime.runCallback(runtime)(_sendInitialize(_, channel.port2))
    }
    const onHidden = () => {
      console.log("onHidden", _webView._id)
      port1 = undefined
    }
    return { onShown, onHidden }
  })
}

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

export const ChromeExtHost = Layer.scoped(
  ExtHost.ExtHost,
  Effect.gen(function*() {
    const contributes = yield* CurrentContributes
    const whenEvaluator = yield* ExtWhenEvaluator.ExtWhenEvaluator

    const asWorkspaceRelativePath = (uri: string): string => {
      return uri
    }

    const revealFileLineColumnRange = (
      _path: string,
      _line: number,
      _column: number,
      _endLine: number,
      _endColumn: number
    ) =>
      Effect.sync(() => {
        chrome.devtools.panels.openResource(_path, _line, _column)
      })

    const commandHandlers = new Map<string, ExtCommand.HandlerNoContext<string>>()

    const registerCommand = (
      _command: ExtCommand.AnyWithProps,
      _handler: ExtCommand.HandlerNoContext<string>
    ): Effect.Effect<void, never, never> => {
      return Effect.sync(() => commandHandlers.set(_command._id, _handler))
    }

    const executeCommand = (
      _command: ExtCommand.AnyWithProps,
      _arg: any
    ): Effect.Effect<any, any, never> => {
      const handler = commandHandlers.get(_command._id)
      if (!handler) return Effect.die(`Command ${_command._id} not found`)
      return handler(_arg)
    }

    const registerTreeView = (
      _treeView: ExtTreeView.AnyWithProps,
      _builder: ExtTreeView.ExtTreeViewBuilder<any, never>
    ): Effect.Effect<void, never, never> => {
      return Effect.die("registerTreeView is not supported in chrome")
    }

    const registerWebView = (
      _webView: ExtWebView.AnyWithProps,
      _builder: ExtWebView.ExtWebViewBuilder<Scope.Scope>
    ): Effect.Effect<void, never, never> => {
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

    const setVariable = (_id: string, _value: any) => whenEvaluator.setVar(_id, _value)

    const readConfig = (config: ExtConfig.AnyWithProps) => {
      return Effect.gen(function*() {
        const ref = yield* SubscriptionRef.make(config.defaultValue)
        return {
          get: SubscriptionRef.get(ref),
          changes: ref.changes
        }
      })
    }

    const registerConfig = (_config: ExtConfig.AnyWithProps) => {
      return Effect.void
    }

    return {
      asWorkspaceRelativePath,
      registerCommand,
      executeCommand,
      revealFileLineColumnRange,
      registerTreeView,
      registerWebView,
      setVariable,
      registerConfig,
      readConfig
    }
  })
)

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

export function treeViewInlineAction<
  V extends ExtTreeView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
) {
  return <
    K extends Array<ExtTreeAsExtWebView.Keys<V, C>>
  >(
    ..._keys: K
  ): Layer.Layer<
    never,
    never,
    | ExtTreeAsExtWebView.ExtTreeAsExtWebView
    | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>>
    | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
  > =>
    Layer.unwrapEffect(
      Effect.map(ExtTreeAsExtWebView.ExtTreeAsExtWebView, (_) => _.treeViewInlineAction(_view, _command)(..._keys))
    )
}

export function treeViewNavigationAction<
  V extends ExtTreeView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
): Layer.Layer<
  never,
  never,
  | ExtTreeAsExtWebView.ExtTreeAsExtWebView
  | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>>
  | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.unwrapEffect(
    Effect.map(ExtTreeAsExtWebView.ExtTreeAsExtWebView, (_) => _.treeViewNavigationAction(_view, _command))
  )
}

export function webViewNavigationAction<
  V extends ExtWebView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
): Layer.Layer<
  never,
  never,
  CurrentContributes | ExtWebView.UnknownWebView<ExtWebView.Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.empty
}
