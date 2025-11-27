import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import "@vscode-elements/elements/dist/bundled"
import "../elements.css"
import "./index.css"

createRoot(document.getElementById("config-root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
