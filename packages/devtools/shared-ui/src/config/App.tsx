import { Atom, useAtomSuspense } from "@effect-atom/atom-react"
import * as Reactivity from "@effect/experimental/Reactivity"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as React from "react"
import * as WebviewMessaging from "../WebviewMessaging.ts"
import {
  ConfigInfo,
  ConfigList,
  Initialized,
  InMessage,
  OutMessage,
  RequestConfigInfo,
  RequestConfigList
} from "./messages.ts"

const styles = {
  scrollable: {
    flex: 1,
    minHeight: "100px"
  },
  container: {
    padding: "var(--vscode-font-size)"
  },
  button: {
    paddingRight: "var(--vscode-font-size)"
  }
}

class TreeApp extends Effect.Service<TreeApp>()("TreeApp", {
  dependencies: [WebviewMessaging.layer(Schema.encodeUnknownSync(Initialized)(new Initialized()))],
  scoped: Effect.gen(function*() {
    const { events, postMessage } = yield* WebviewMessaging.WebviewMessaging
    const reactivity = yield* Reactivity.Reactivity

    const ofType = <A extends Schema.Schema.AnyNoContext>(
      schema: A
    ): Stream.Stream<Schema.Schema.Type<A>> =>
      Stream.fromPubSub(events).pipe(
        Stream.filterMap(Schema.decodeUnknownOption(schema))
      )

    yield* ofType(InMessage).pipe(
      Stream.mapEffect((_) => {
        switch (_._tag) {
          case "InvalidatedIds": {
            return reactivity.invalidate(
              _.itemIds._tag === "Some" ? _.itemIds.value : ["root"]
            )
          }
        }
        return Effect.void
      }),
      Stream.runDrain,
      Effect.forkScoped
    )

    const request = (value: OutMessage) =>
      Schema.encodeUnknown(OutMessage)(value).pipe(
        Effect.flatMap(postMessage),
        Effect.ignoreLogged
      )

    return {
      ofType,
      request
    }
  })
}) {}

const atomRuntime = Atom.runtime(TreeApp.Default).pipe(Atom.keepAlive)

const configIdsAtom = atomRuntime
  .atom(
    Stream.unwrap(
      Effect.gen(function*() {
        const treeApp = yield* TreeApp
        return treeApp.ofType(ConfigList).pipe(
          Stream.map((_) => _.configIds),
          Stream.onStart(
            treeApp.request(new RequestConfigList())
          )
        )
      })
    )
  )
  .pipe(Atom.withReactivity(["root"]))

const infoAtom = Atom.family((configId: string) =>
  atomRuntime
    .atom(
      Stream.unwrap(
        Effect.gen(function*() {
          const treeApp = yield* TreeApp
          return treeApp.ofType(ConfigInfo).pipe(
            Stream.filter((_) => _.id === configId),
            Stream.onStart(
              treeApp.request(new RequestConfigInfo({ configId }))
            )
          )
        })
      )
    )
    .pipe(Atom.withReactivity(["root", configId]))
)

function ConfigControl({ configId }: { configId: string }) {
  const { value: info } = useAtomSuspense(infoAtom(configId))
  const id = React.useId()
  return (
    <vscode-form-group variant="vertical">
      <vscode-label htmlFor={id}>
        {info.title}
      </vscode-label>
      <vscode-textfield
        id={id}
        value={String(info.info.value)}
      >
      </vscode-textfield>
      <vscode-form-helper>
        <p>
          {info.description}
        </p>
      </vscode-form-helper>
    </vscode-form-group>
  )
}

export function App() {
  const configIds = useAtomSuspense(configIdsAtom)
  return (
    <vscode-scrollable style={styles.scrollable}>
      <div style={styles.container}>
        <vscode-form-container>
          {configIds.value.map((configId) => <ConfigControl key={configId} configId={configId} />)}
        </vscode-form-container>
        <vscode-button icon="save" style={styles.button}>Save</vscode-button>
        <vscode-button secondary icon="refresh" style={styles.button}>Reset</vscode-button>
      </div>
    </vscode-scrollable>
  )
}
