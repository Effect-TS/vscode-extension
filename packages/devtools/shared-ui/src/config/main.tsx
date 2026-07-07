import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

import "./index.css"
import "../components/index.ts"

createRoot(document.getElementById("config-root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
