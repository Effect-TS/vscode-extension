import * as ExtConfig from "@effect/devtools/shared/core/ExtConfig";
import * as ExtHost from "@effect/devtools/shared/core/ExtHost";
import * as ExtWebView from "@effect/devtools/shared/core/ExtWebView";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as SubscriptionRef from "effect/SubscriptionRef";
import React from "react";
import  * as Scope from "effect/Scope";
import * as Deferred from "effect/Deferred";
import * as Mailbox from "effect/Mailbox";
import * as Runtime from "effect/Runtime";

export function RenderToComponent<ROut>(props: { layer: Layer.Layer<ROut, never, ExtHost.ExtHost> }) {
  const rootRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    if(rootRef.current) {
    const runtime = ManagedRuntime.make(props.layer.pipe(
      Layer.provide(StorybookExtHost(rootRef.current))
    ));

    return () => {
      runtime.dispose();
    };
  }
  }, [props.layer]);

  return React.createElement("iframe", { ref: rootRef });
};

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

const StorybookExtHost = (iframe: HTMLIFrameElement) =>  Layer.scoped(
  ExtHost.ExtHost,
  Effect.gen(function*() {
    const appScope = yield* Effect.scope

    const asWorkspaceRelativePath = (uri: string): string => {
      return uri;
    };


    const registerWebView = (
      _webView: ExtWebView.AnyWithProps,
      _builder: ExtWebView.ExtWebViewBuilder<never>,
    ): Effect.Effect<void, never, never> => Effect.gen(function*() {
      iframe.src = _webView.type
      const { onShown, onHidden } = yield* createWebViewBooter(_webView, _builder, (w, port2) => Effect.sync(() => w.postMessage("", "*", [port2]))).pipe(
        Scope.extend(appScope)
      )

      iframe.addEventListener("load", () => {
        if(iframe.contentWindow) onShown(iframe.contentWindow)
      })
      iframe.addEventListener("unload", () => {
        onHidden()
      })
      return Effect.void
    });

    const readConfig = (config: ExtConfig.AnyWithProps) => {
      return Effect.gen(function*() {
        const ref = yield* SubscriptionRef.make(config.defaultValue);
        return {
          get: SubscriptionRef.get(ref),
          changes: ref.changes,
        };
      });
    };

    return {
      asWorkspaceRelativePath,
      registerCommand: () => Effect.void,
      executeCommand: () => Effect.void,
      revealFileLineColumnRange: () => Effect.void,
      registerWebView,
      registerTreeView: () => Effect.void,
      registerTreeViewInlineAction: () => () => Effect.void,
      registerTreeViewNavigationAction: () => Effect.void,
      registerTreeViewTitleAction: () => Effect.void,
      setVariable: () => Effect.void,
      registerConfig: () => Effect.void,
      readConfig,
    };
  }),
);
