import "@vscode-elements/elements/dist/bundled"
import { Atom, useAtomSuspense } from "@effect-atom/atom-react"
import type { VscTabsSelectEvent } from "@vscode-elements/elements/dist/vscode-tabs/vscode-tabs"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as React from "react"
import { Initialized, InitializePanel } from "./messages.ts"

const styles = {
  iframe: {
    borderStyle: "none" as const,
    width: "100%"
  },
  iframeWithFlex: {
    borderStyle: "none" as const,
    width: "100%",
    flex: 1
  },
  splitLayout: {
    flex: 1
  },
  startSlot: {
    display: "flex" as const,
    flexDirection: "column" as const
  },
  tabs: {
    display: "flex" as const,
    flexDirection: "column" as const
  },
  tabPanelActive: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1
  },
  tabPanelInactive: {
    display: "none" as const
  }
}

interface Panels {
  id: string
  title: string
  page: string
  position: "side" | "main"
  port: MessagePort
}

class ContainerApp extends Effect.Service<ContainerApp>()("ContainerApp", {
  scoped: Effect.gen(function*() {
    const panels = yield* SubscriptionRef.make<Array<Panels>>([])
    const runtime = yield* Effect.runtime<never>()

    // note, this panel do not use the WebviewMessaging service because it is not a webview, rather a polyfill for chrome devtools panels env like
    let port: MessagePort | undefined = undefined
    function onMessagePort(event: MessageEvent) {
      Effect.gen(function*() {
        if (typeof event.data === "string" && event.data.length === 0) {
          // container panel
          if (!port && event.ports && event.ports.length > 0) {
            port = event.ports[0]
            const initialized = yield* Schema.encodeUnknown(Initialized)(new Initialized())
            port.postMessage(initialized)
          }
          return
        } else if (event.ports && event.ports.length > 0) {
          // child panel
          const panelData = yield* Schema.decodeUnknown(InitializePanel)(
            event.data
          )
          yield* SubscriptionRef.update(panels, (panels) => [
            ...panels.filter((p) => p.id !== panelData.id),
            {
              ...panelData,
              port: event.ports[0]
            }
          ])
        }
      }).pipe(Effect.ignoreLogged, Runtime.runPromise(runtime))
    }

    yield* Effect.acquireRelease(
      Effect.sync(() => window.addEventListener("message", onMessagePort)),
      () => Effect.sync(() => window.removeEventListener("message", onMessagePort))
    )

    return {
      panels: panels.changes
    }
  })
}) {}

const atomRuntime = Atom.runtime(ContainerApp.Default).pipe(Atom.keepAlive)

function WebViewFrame(props: Panels & { style?: React.CSSProperties }) {
  const ref = React.useRef<HTMLIFrameElement>(null)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const onLoad = React.useCallback(() => {
    setHasLoaded(true)
  }, [props.port])
  React.useEffect(() => {
    if (hasLoaded && ref.current) {
      ref.current?.contentWindow?.postMessage("", "*", [props.port])
    }
  }, [hasLoaded, ref.current, props.port])
  return (
    <iframe
      ref={ref}
      src={props.page}
      onLoad={onLoad}
      style={{ ...styles.iframe, ...props.style }}
    >
    </iframe>
  )
}

const panelsAtom = atomRuntime.atom(
  Stream.unwrap(
    Effect.gen(function*() {
      const containerApp = yield* ContainerApp
      return containerApp.panels
    })
  )
)

function SidePanel(props: Panels) {
  return (
    <vscode-collapsible title={props.title} open>
      <WebViewFrame key={props.id} {...props} />
    </vscode-collapsible>
  )
}

export function App() {
  const panels = useAtomSuspense(panelsAtom)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const onTabsSelect = React.useCallback((event: VscTabsSelectEvent) => {
    setSelectedIndex(event.detail.selectedIndex)
  }, [])

  return (
    <>
      <vscode-split-layout
        initial-handle-position="25%"
        fixed-pane="start"
        style={styles.splitLayout}
      >
        <div slot="start" style={styles.startSlot}>
          {pipe(
            panels.value,
            Array.filter((panel) => panel.position === "side"),
            Array.map((panel) => <SidePanel key={panel.id} {...panel} />)
          )}
        </div>
        <vscode-tabs
          slot="end"
          selected-index={selectedIndex}
          onvsc-tabs-select={onTabsSelect}
          panel
          style={styles.tabs}
        >
          {pipe(
            panels.value,
            Array.filter((panel) => panel.position === "main"),
            Array.map((panel, index) => (
              <>
                <vscode-tab-header slot="header">
                  {panel.title}
                </vscode-tab-header>
                <vscode-tab-panel style={index === selectedIndex ? styles.tabPanelActive : styles.tabPanelInactive}>
                  <WebViewFrame
                    key={panel.id}
                    {...panel}
                    style={styles.iframeWithFlex}
                  />
                </vscode-tab-panel>
              </>
            ))
          )}
        </vscode-tabs>
      </vscode-split-layout>
    </>
  )
}
