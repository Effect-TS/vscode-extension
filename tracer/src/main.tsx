import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { WebviewApi } from "vscode-webview"
import './index.css'
import App from './App.tsx'


declare const acquireVsCodeApi: () => WebviewApi<unknown>

createRoot(document.getElementById('tracer-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

acquireVsCodeApi().postMessage({
  _tag: "Booted"
})