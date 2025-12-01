import { useVirtualizer } from "@tanstack/react-virtual";
import * as React from "react";
import "../components/index.ts";
import { useContextMenu, VscodeScrollable } from "../components/index.ts";

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

function AppContent() {
  const parentRef = React.useRef<null | VscodeScrollable>(null);

  const contextMenu = useContextMenu(
    [
      {
        label: "Option 1",
        value: "option1",
      },
      {
        label: "Option 2",
        value: "option2",
      },
    ],
    (value) => {
      console.log(`Selected option: ${value}`);
    },
  );

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

  const handleMenuClick = () => {
    contextMenu.open();
  };

  return (
    <vscode-split-layout
      style={styles.splitLayout}
      initial-handle-position="75%"
      split="horizontal"
    >
      <div slot="start" style={styles.spanContainer}>
        <div style={styles.toolbar}>
          <div style={{ flex: 1 }}></div>
          <div style={{ position: "relative" }}>
            <vscode-button onClick={handleMenuClick}  ref={contextMenu.ref} aria-label="More options">
              <span className="codicon codicon-more"></span>
            </vscode-button>
          </div>
        </div>
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
  );
}

function App() {
  return <AppContent />;
}

export default App;
