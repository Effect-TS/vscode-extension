import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Mailbox from "effect/Mailbox"
import * as Console from "effect/Console"
import { WebviewApi } from "vscode-webview"
import { Span, SpanEvent } from "@effect/experimental/DevTools/Domain"
import { Rx } from "@effect-rx/rx-react"

export class Booted extends Schema.TaggedClass<Booted>()("Booted", {}) {}
export const HostMessage = Schema.Union(Booted, Span, SpanEvent)

const decode = Schema.decodeUnknownSync(HostMessage)

declare const acquireVsCodeApi: () => WebviewApi<unknown>
const booted: typeof Booted.Encoded = { _tag: "Booted" }

export class VscodeWebview extends Effect.Service<VscodeWebview>()(
  "VscodeWebview",
  {
    accessors: true,
    scoped: Effect.gen(function* () {
      const api = acquireVsCodeApi()
      const mailbox = yield* Effect.acquireRelease(
        Mailbox.make<typeof HostMessage.Type>(),
        mailbox => mailbox.shutdown,
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
          }),
      )

      yield* mailbox.take.pipe(
        Effect.tap(Console.log),
        Effect.forever,
        Effect.forkScoped,
      )

      return {
        api,
        messages: Mailbox.toStream(mailbox),
      } as const
    }),
  },
) {}

// rx

export const runtime = Rx.runtime(VscodeWebview.Default)
