import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PubSub from "effect/PubSub"
import type { WebviewApi } from "vscode-webview"

export class WebviewMessaging extends Context.Tag("WebviewMessaging")<WebviewMessaging, {
  events: PubSub.PubSub<unknown>
  postMessage: (message: unknown) => Effect.Effect<void>
}>() {}

const layerVscode = (api: WebviewApi<unknown>, helloMessage: unknown) =>
  Layer.scoped(
    WebviewMessaging,
    Effect.gen(function*() {
      const events = yield* PubSub.sliding<unknown>(2)
      const onMessage = (event: MessageEvent) => {
        if (event.ports.length === 0) events.unsafeOffer(event.data)
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener("message", onMessage)),
        () => Effect.sync(() => window.removeEventListener("message", onMessage))
      )
      yield* Effect.sync(() => api.postMessage(helloMessage)).pipe(Effect.forkScoped)
      return {
        events,
        postMessage: (message: unknown) => Effect.sync(() => api.postMessage(message))
      }
    })
  )

const layerMessageChannel = (helloMessage: unknown) =>
  Layer.scoped(
    WebviewMessaging,
    Effect.gen(function*() {
      const events = yield* PubSub.sliding<unknown>(1000)
      let port: MessagePort | undefined = undefined
      const onPortMessage = (event: MessageEvent) => {
        if (event.ports && event.ports.length > 0) {
          port = event.ports[0]
          port.onmessage = (event) => {
            if (event.ports.length === 0) events.unsafeOffer(event.data)
          }
          port.postMessage(helloMessage)
        }
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener("message", onPortMessage)),
        () => Effect.sync(() => window.removeEventListener("message", onPortMessage))
      )
      return {
        events,
        postMessage: (message: unknown) => Effect.sync(() => port?.postMessage(message))
      }
    })
  )

// note that this cannot be called multiple times, because will throw an error
let vscodeApi: WebviewApi<unknown> | undefined = undefined
if (typeof acquireVsCodeApi === "function") {
  vscodeApi = acquireVsCodeApi()
}

// use what is available
export const layer = (helloMessage: unknown) => {
  if (vscodeApi) {
    return layerVscode(vscodeApi, helloMessage)
  } else {
    return layerMessageChannel(helloMessage)
  }
}
