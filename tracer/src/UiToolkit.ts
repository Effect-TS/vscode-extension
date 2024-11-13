import { provideReactWrapper } from "@microsoft/fast-react-wrapper"
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
} from "@vscode/webview-ui-toolkit"
import React from "react"

export const { wrap } = provideReactWrapper(React, provideVSCodeDesignSystem())

export const VsCodeButton = wrap(vsCodeButton(), {
  name: "vscode-button",
})
