import { useAtomSet, useAtomSuspense } from "@effect-atom/atom-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as React from "react"
import type { VscodeScrollable } from "../components/index.ts"
import { currentSpanIdsAtom, refreshApp, spanDataForListAtom, usedRangeAtom } from "./atom.ts"
import type { SpanId } from "./messages.ts"

const styles = {
  splitLayout: {
    flex: 1
  },
  spanContainer: {
    display: "flex",
    flexDirection: "column" as const
  },
  tabsContainer: {
    display: "flex",
    flexDirection: "column" as const
  },
  scrollable: {
    flex: 1,
    overflowY: "auto" as const,
    contain: "strict" as const
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    padding: "4px 8px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    backgroundColor: "var(--vscode-editorWidget-background)"
  },
  spanBarContainer: {
    display: "flex" as const,
    overflow: "hidden" as const,
    flexDirection: "row" as const,
    padding: "6px",
    boxSizing: "border-box" as const
  }
}

function SpanBar(props: { containerWidth: number; startTime: Option.Option<bigint>; endTime: Option.Option<bigint> }) {
  const { value: usedRange } = useAtomSuspense(usedRangeAtom)
  const start = pipe(
    props.startTime,
    Option.map((startTime) =>
      startTime < usedRange[0] ? 0 : (Number(startTime - usedRange[0]) / Number(usedRange[1] - usedRange[0])) * 100
    ),
    Option.getOrElse(() => 0)
  )
  const end = pipe(
    props.endTime,
    Option.map((endTime) =>
      endTime > usedRange[1] ? 100 : (Number(endTime - usedRange[0]) / Number(usedRange[1] - usedRange[0])) * 100
    ),
    Option.getOrElse(() => 100)
  )
  return (
    <div style={{ ...styles.spanBarContainer, width: props.containerWidth }}>
      <div style={{ width: start + "%" }} />
      <div style={{ width: Math.max(0.001, end - start) + "%", backgroundColor: "var(--vscode-list-focusOutline)" }}>
      </div>
    </div>
  )
}

function SpanRow(props: { spanId: SpanId; index: number; barWidth: number; measureElement: (element: any) => void }) {
  const { value: spanInfo } = useAtomSuspense(spanDataForListAtom(props.spanId))
  const name = Option.getOrElse(spanInfo.name, () => props.spanId.spanId)
  return (
    <vscode-tree-item
      key={props.spanId.key}
      data-index={props.index}
      data-span-id={props.spanId.spanId}
      data-trace-id={props.spanId.traceId}
      ref={props.measureElement}
    >
      <div style={{ display: "flex", flexDirection: "row" }}>
        <div style={{ flex: 1, overflow: "hidden", paddingLeft: `${spanInfo.depth * 10}px` }}>{name}</div>
        <SpanBar containerWidth={props.barWidth} startTime={spanInfo.startTime} endTime={spanInfo.endTime} />
      </div>
    </vscode-tree-item>
  )
}

function MainSpanList() {
  const parentRef = React.useRef<null | VscodeScrollable>(null)
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 })
  const spanGraphColumnRef = React.useRef(null)
  const { value: spanIds } = useAtomSuspense(currentSpanIdsAtom)
  const maxSize = React.useRef(10)

  React.useEffect(() => {
    if (spanGraphColumnRef.current) {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setDimensions({
            width: Math.max(0, entry.contentRect.width - 10),
            height: entry.contentRect.height
          })
        }
      })
      observer.observe(spanGraphColumnRef.current)
      return () => {
        observer.disconnect()
      }
    }
  }, [])

  const virtualizer = useVirtualizer({
    count: spanIds.length,
    getScrollElement: () => {
      const root = parentRef.current
      if (root && root.shadowRoot) {
        return root.shadowRoot.querySelector(
          ".scrollable-container"
        ) as HTMLElement | null
      }
      return null
    },
    estimateSize: () => maxSize.current,
    overscan: 10,
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height
      maxSize.current = Math.max(maxSize.current, height)
      return maxSize.current
    }
  })

  const items = virtualizer.getVirtualItems()

  return (
    <>
      <vscode-textfield placeholder="Search" style={{ width: "100%" }}>
        <vscode-icon
          slot="content-before"
          name="search"
          title="search"
        >
        </vscode-icon>
      </vscode-textfield>
      <vscode-split-layout>
        <vscode-label slot="start">Name</vscode-label>
        <vscode-label slot="end" ref={spanGraphColumnRef}>Graph</vscode-label>
      </vscode-split-layout>
      <vscode-scrollable
        ref={parentRef}
        className="List"
        style={{
          flex: 1,
          contain: "strict"
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative"
          }}
        >
          <vscode-tree
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${items[0]?.start ?? 0}px)`
            }}
          >
            {items.map((virtualRow) => (
              <SpanRow
                index={virtualRow.index}
                spanId={spanIds[virtualRow.index]}
                barWidth={dimensions.width}
                measureElement={virtualizer.measureElement}
              />
            ))}
          </vscode-tree>
        </div>
      </vscode-scrollable>
    </>
  )
}

function AppContent() {
  const refresh = useAtomSet(refreshApp)

  return (
    <>
      <vscode-toolbar-container>
        <vscode-toolbar-button icon="refresh" title="Refresh" onClick={refresh} />
      </vscode-toolbar-container>
      <vscode-split-layout
        style={styles.splitLayout}
        initial-handle-position="75%"
        split="vertical"
      >
        <div slot="start" style={styles.spanContainer}>
          <MainSpanList />
        </div>
        <div slot="end" style={styles.tabsContainer}>
          <vscode-scrollable slot="end" style={styles.scrollable}>
            Infos
          </vscode-scrollable>
        </div>
      </vscode-split-layout>
    </>
  )
}

function App() {
  return <AppContent />
}

export default App
