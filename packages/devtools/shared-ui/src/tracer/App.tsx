import { useAtomSet, useAtomSuspense } from "@effect-atom/atom-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { pipe } from "effect/Function"
import * as Option from "effect/Option"
import * as React from "react"
import type { VscodeScrollable } from "../components/index.ts"
import { currentSpanIdsAtom, isSpanIdExpandedAtom, refreshApp, selectedSpanDetailsAtom, setSelectedSpanIdAtom, spanDataForListAtom, toggleSpanIdAtom, usedRangeAtom } from "./atom.ts"
import  { SpanId } from "./messages.ts"
import type { VscTabsSelectEvent } from "@vscode-elements/elements/dist/vscode-tabs/vscode-tabs"
import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Inspectable from "effect/Inspectable"

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
  },
  tabPanelActive: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1
  },
  tabPanelInactive: {
    display: "none" as const
  },
  treeItem: {
    display: "flex",
    flexDirection: "row" as const
  },
  treeItemNameLabel: {},
  treeItemDescription: {
    marginLeft: "6px",
    opacity: 0.7
  },
  sidebarSpanInfoTabs: {
    display: "flex",
    flexDirection: "column" as const,
    flex: 1
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
      <div
        style={{
          width: Math.max(0.001, end - start) + "%",
          minWidth: "1px",
          backgroundColor: "var(--vscode-list-focusOutline)"
        }}
      >
      </div>
    </div>
  )
}

function SpanRow(props: { spanId: SpanId; index: number; barWidth: number; measureElement: (element: any) => void }) {
  const { value: spanInfo } = useAtomSuspense(spanDataForListAtom(props.spanId))
  const toggleExpanded = useAtomSet(toggleSpanIdAtom(props.spanId))
  const {value: isExpanded} = useAtomSuspense(isSpanIdExpandedAtom(props.spanId))
  const name = Option.getOrElse(spanInfo.name, () => props.spanId.spanId)

  return (
    <vscode-tree-item
      key={props.spanId.key}
      data-index={props.index}
      data-span-id={props.spanId.spanId}
      data-trace-id={props.spanId.traceId}
      ref={props.measureElement}
    >
      
      <div style={{ display: "flex", flexDirection: "row", paddingLeft: `calc(${spanInfo.depth} * var(--vscode-font-size))` }}>
      {spanInfo.hasChildren && <vscode-icon action-icon name={isExpanded ? "chevron-down" : "chevron-right"} title={isExpanded ? "Collapse" : "Expand"} onvsc-click={toggleExpanded} />}
        <div style={{ flex: 1, overflow: "hidden"}}>          
          {name}
        </div>
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
  const setSelectedSpanId = useAtomSet(setSelectedSpanIdAtom)
  const maxSize = React.useRef(10)

  console.log("MainSpanList", spanIds.length)

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
            onvsc-tree-select={setSelectedSpanId}
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

function SidebarSpanInfo() {
  const [selectedTab, setSelectedTab] = React.useState(0)
  const onTabsSelect = React.useCallback((event: VscTabsSelectEvent) => {
    setSelectedTab(event.detail.selectedIndex)
  }, [])
  return (
    <vscode-tabs panel selected-index={selectedTab} onvsc-tabs-select={onTabsSelect} style={styles.sidebarSpanInfoTabs}>
      <vscode-tab-header slot="header">Info</vscode-tab-header>
      <vscode-tab-panel style={selectedTab === 0 ? styles.tabPanelActive : styles.tabPanelInactive}>
        <SelectedSpanInfo />
      </vscode-tab-panel>
      <vscode-tab-header slot="header">Events</vscode-tab-header>
      <vscode-tab-panel style={selectedTab === 1 ? styles.tabPanelActive : styles.tabPanelInactive}>
        <SelectedSpanEvents />
      </vscode-tab-panel>
    </vscode-tabs>
  )
}

function SpanInfoTreeItem(props: { name: string; description: string }) {
  return (
    <vscode-tree-item>
      <div style={styles.treeItem}>
        <div style={styles.treeItemNameLabel}>{props.name}</div>
        <div style={styles.treeItemDescription}>{props.description}</div>
      </div>
    </vscode-tree-item>
  )
}
function SelectedSpanInfo() {
  const { value: spanDetails } = useAtomSuspense(selectedSpanDetailsAtom)
  const content = Option.match(spanDetails, {
    onSome: (span) => {
      return <vscode-tree>
        <SpanInfoTreeItem name="Trace ID" description={span.spanId.traceId} />
        <SpanInfoTreeItem name="Span ID" description={span.spanId.spanId} />
      </vscode-tree>
    },
    onNone: () => <div>No span selected</div>
  })
  return (
    <vscode-scrollable style={styles.scrollable}>
      {content}
    </vscode-scrollable>
  )
}
function SpanInfoEventItem(props: Domain.SpanEvent ) {
  return (
    <vscode-tree-item>
      <div style={styles.treeItem}>
        <div style={styles.treeItemNameLabel}>{props.name}</div>
        <div style={styles.treeItemDescription}>{props.startTime}</div>
      </div>
        {
          Object.entries(props.attributes).map(([key, value]) => <vscode-tree-item key={key}>
            <div style={styles.treeItem}>
              <div style={styles.treeItemNameLabel}>{key}</div>
              <div style={styles.treeItemDescription}>{Inspectable.toStringUnknown(value)}</div>
            </div>
          </vscode-tree-item>)
        }
    </vscode-tree-item>
  )
}
function SelectedSpanEvents() {
  const { value: spanDetails } = useAtomSuspense(selectedSpanDetailsAtom)
  const content = Option.match(spanDetails, {
    onSome: (info) => <vscode-tree>
      {info.events.map((_, i) => <SpanInfoEventItem key={i} {..._} />)}
    </vscode-tree>,
    onNone: () => null
  })
  return (
    <vscode-scrollable style={styles.scrollable}>
      {content}
    </vscode-scrollable>
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
          <SidebarSpanInfo />
        </div>
      </vscode-split-layout>
    </>
  )
}

function App() {
  return <AppContent />
}

export default App
