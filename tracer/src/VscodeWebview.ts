import { Span, SpanEvent } from "@effect/experimental/DevTools/Domain"
import * as Effect from "effect/Effect"
import * as Mailbox from "effect/Mailbox"
import * as Schema from "effect/Schema"
import type { WebviewApi } from "vscode-webview"

export class Booted extends Schema.TaggedClass<Booted>()("Booted", {}) {}
export class ResetTracer extends Schema.TaggedClass<ResetTracer>()("ResetTracer", {}) {}
export class GoToLocation extends Schema.TaggedClass<GoToLocation>()("GoToLocation", {
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int
}) {}

export const HostMessage = Schema.Union(ResetTracer, Span, SpanEvent)

const decode = Schema.decodeUnknownSync(HostMessage)
const encode = Schema.encodeUnknownSync(Schema.Union(GoToLocation))

declare const acquireVsCodeApi: () => WebviewApi<unknown>
const booted: typeof Booted.Encoded = { _tag: "Booted" }

export class VscodeWebview extends Effect.Service<VscodeWebview>()(
  "VscodeWebview",
  {
    accessors: true,
    scoped: Effect.gen(function*() {
      const api = acquireVsCodeApi()
      const mailbox = yield* Effect.acquireRelease(
        Mailbox.make<typeof HostMessage.Type>(),
        (mailbox) => mailbox.shutdown
      )

      api.postMessage(booted)

      const onMessage = (event: MessageEvent) => {
        mailbox.unsafeOffer(decode(event.data))
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          window.addEventListener("message", onMessage)
        }),
        () =>
          Effect.sync(() => {
            window.removeEventListener("message", onMessage)
          })
      )

      return {
        api,
        goToLocation: (path: string, line: number, column: number) =>
          Effect.sync(() => api.postMessage(encode(new GoToLocation({ path, line, column })))),
        messages: mailbox as Mailbox.ReadonlyMailbox<typeof HostMessage.Type>
      } as const
    })
  }
) {}
