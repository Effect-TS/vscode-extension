import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";
import "../components/index.ts";
import { VscodeScrollable } from "../components/index.ts";

const styles = {
  splitLayout: {
    flex: 1,
  },
  spanContainer: {
    display: "flex",
    flexDirection: "column" as const,
  },
  tabsContainer: {
    display: "flex",
    flexDirection: "column" as const,
  },
  scrollable: {
    flex: 1,
    overflowY: "auto" as const,
    contain: "strict" as const,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    padding: "4px 8px",
    borderBottom: "1px solid var(--vscode-editorWidget-border)",
    backgroundColor: "var(--vscode-editorWidget-background)",
  },
};

function SpanBar(props: { containerWidth: number, start: number, length: number }){
  return <div style={{ display: "flex", overflow: "hidden", flexDirection: "row", width: props.containerWidth, padding: "6px", boxSizing: "border-box" }}>
    <div style={{ width: props.start + "%" }} />
    <div style={{ width: Math.min(props.length, 100 - props.start) + "%", backgroundColor: "var(--vscode-list-focusOutline)" }}></div>
  </div>
}

function MainSpanList() {
  const parentRef = React.useRef<null | VscodeScrollable>(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
  const observedElementRef = React.useRef(null);

  React.useEffect(() => {
      if (observedElementRef.current) {
          const observer = new ResizeObserver((entries) => {
              for (let entry of entries) {
                  setDimensions({
                      width: Math.max(0, entry.contentRect.width - 10), // account for scrollbar width
                      height: entry.contentRect.height,
                  });
              }
          });

          observer.observe(observedElementRef.current);

          // Cleanup function
          return () => {
              observer.disconnect();
          };
      }
  }, []);

  const virtualizer = useVirtualizer({
    count: 1000,
    getScrollElement: () => {
      const root = parentRef.current;
      if (root && root.shadowRoot)
        return root.shadowRoot.querySelector(
          ".scrollable-container",
        ) as HTMLElement | null;
      return null;
    },
    estimateSize: () => 25,
    overscan: 10,
    measureElement: (element) => {
      const height = element.getBoundingClientRect().height;
      return height !== 0 ? height : 25;
    },
  });

  const items = virtualizer.getVirtualItems();

  return (<>
  <vscode-textfield placeholder="Search" style={{ width: "100%" }}>
    <vscode-icon
      slot="content-before"
      name="search"
      title="search"
    ></vscode-icon>
  </vscode-textfield>
    <vscode-split-layout>
      <vscode-label slot="start">Name</vscode-label>
      <vscode-label slot="end" ref={observedElementRef}>Graph</vscode-label>
    </vscode-split-layout>
<vscode-scrollable
          ref={parentRef}
          className="List"
          style={{
            flex: 1,
            contain: "strict",
          }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            <vscode-tree
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${items[0]?.start ?? 0}px)`,
              }}
            >
              {items.map((virtualRow) => (
                <vscode-tree-item
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                >
                  <div style={{ display: "flex", flexDirection: "row" }}>
                    <div style={{ flex: 1, overflow: "hidden"}}>Span {virtualRow.index}</div>
                    <SpanBar containerWidth={dimensions.width} start={virtualRow.index % 20 / 20 *100} length={12} />
                  </div>
                </vscode-tree-item>
              ))}
            </vscode-tree>
          </div>
        </vscode-scrollable></>
  )
}

function AppContent() {

  return (
    <vscode-split-layout
      style={styles.splitLayout}
      initial-handle-position="75%"
      split="horizontal"
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
  );
}

function App() {
  return <AppContent />;
}

export default App;
