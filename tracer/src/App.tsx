import { VsCodeButton } from "./UiToolkit"
import { useRxMount } from "@effect-rx/rx-react"
import { runtime } from "./VsCode"

export default function App() {
  useRxMount(runtime)

  return (
    <VsCodeButton onClick={() => console.log("boom")}>Click me</VsCodeButton>
  )
}
