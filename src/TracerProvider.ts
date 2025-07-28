import { Span, SpanEvent } from "@effect/experimental/DevTools/Domain"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as vscode from "vscode"
import type { Client } from "./Clients"
import { Clients } from "./Clients"
import { listenFork, registerWebview, VsCodeContext, Webview } from "./VsCode"

export class Booted extends Schema.TaggedClass<Booted>()("Booted", {}) {}

export const WebviewMessage = Schema.Union(Booted)
const HostMessage = Schema.Union(Span, SpanEvent)

const encode = Schema.encodeSync(HostMessage)

export const TracerExtendedLive = Layer.effectDiscard(
  registerWebview("effect-tracer-extended", (_context) =>
    Effect.gen(function*() {
      const extension = yield* VsCodeContext
      const view = yield* Webview
      const clients = yield* Clients
      const booted = yield* Deferred.make<void>()

      yield* listenFork(
        view.webview.onDidReceiveMessage,
        (_message: typeof WebviewMessage.Encoded) => Deferred.succeed(booted, void 0)
      )

      view.webview.options = {
        enableScripts: true
      }

      function getUri(extensionUri: vscode.Uri, pathList: Array<string>) {
        return view.webview.asWebviewUri(
          vscode.Uri.joinPath(extensionUri, ...pathList)
        )
      }

      // The CSS file from the React build output
      const stylesUri = getUri(extension.extensionUri, [
        "tracer",
        "build",
        "assets",
        "index.css"
      ])
      // The JS file from the React build output
      const scriptUri = getUri(extension.extensionUri, [
        "tracer",
        "build",
        "assets",
        "index.js"
      ])

      const nonce = getNonce()

      // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
      view.webview.html = `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <title>Effect Tracer</title>
        </head>
        <body>
          <div id="tracer-root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>`

      yield* Deferred.await(booted)

      const handleClient = (client: Client) =>
        Effect.gen(function*() {
          const spans = yield* client.spans
          yield* spans.take.pipe(
            Effect.tap((data) => {
              const message = encode(data)
              view.webview.postMessage(message)
            }),
            Effect.forever,
            Effect.ignore
          )
        }).pipe(Effect.scoped)

      yield* clients.clients.changes.pipe(
        Stream.flatMap(
          Effect.forEach(handleClient, { concurrency: "unbounded" }),
          { switch: true }
        ),
        Stream.runDrain,
        Effect.forkScoped
      )
    }), { webviewOptions: { retainContextWhenHidden: true } })
)

export function getNonce() {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
