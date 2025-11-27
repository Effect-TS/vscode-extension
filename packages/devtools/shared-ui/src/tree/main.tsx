import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import "../elements.css"
import "./index.css"

createRoot(document.getElementById("tree-root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
