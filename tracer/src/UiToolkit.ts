import { provideReactWrapper } from "@microsoft/fast-react-wrapper"
import {
  provideVSCodeDesignSystem,
  vsCodeButton,
  vsCodeDropdown,
  vsCodeOption,
} from "@vscode/webview-ui-toolkit"
import React from "react"

export const { wrap } = provideReactWrapper(React, provideVSCodeDesignSystem())

export const VsCodeButton = wrap(vsCodeButton(), {
  name: "vscode-button",
})

export const VsCodeDropdown = wrap(vsCodeDropdown(), {
  name: "vscode-dropdown",
})

export const VsCodeOption = wrap(vsCodeOption(), {
  name: "vscode-option",
})
