import "@vscode-elements/elements/dist/bundled"
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
    flex: 1
  }
}

function App() {
  return (
    <vscode-split-layout style={styles.splitLayout} initial-handle-position="75%" split="horizontal">
      <div slot="start" style={styles.spanContainer}>
        <vscode-scrollable slot="start" style={styles.scrollable}>
          <vscode-tree>
            <vscode-tree-item>
              <span>Trace 1</span>
            </vscode-tree-item>
            <vscode-tree-item>
              <span>Trace 2</span>
            </vscode-tree-item>
            <vscode-tree-item>
              <span>Trace 3</span>
            </vscode-tree-item>
          </vscode-tree>
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
