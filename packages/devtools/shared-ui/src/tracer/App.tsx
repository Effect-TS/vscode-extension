import "@vscode-elements/elements/dist/bundled"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { VscodeScrollable } from "@vscode-elements/elements"
import * as React from "react"

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
  }
}

function App() {
  const parentRef = React.useRef<null | VscodeScrollable>(null)

  const virtualizer = useVirtualizer({
    count: 1000,
    getScrollElement: () => {
      const root = parentRef.current
      if (root && root.shadowRoot) return root.shadowRoot.querySelector(".scrollable-container") as HTMLElement | null
      return null
    },
    estimateSize: () => 25,
    overscan: 10,
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height
      return height !== 0 ? height : 25
    }
  })

  const items = virtualizer.getVirtualItems()

  return (
    <vscode-split-layout style={styles.splitLayout} initial-handle-position="75%" split="horizontal">
      <div slot="start" style={styles.spanContainer}>
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
                <vscode-tree-item
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
                  {virtualRow.index}
                </vscode-tree-item>
              ))}
            </vscode-tree>
          </div>
        </vscode-scrollable>
      </div>
      <div slot="end" style={styles.tabsContainer}>
        <vscode-scrollable slot="end" style={styles.scrollable}>
          Infos
        </vscode-scrollable>
      </div>
    </vscode-split-layout>
  )
}

export default App
