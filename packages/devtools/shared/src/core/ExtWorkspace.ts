import * as Context_ from "effect/Context"
import * as Layer from "effect/Layer"

export class ExtWorkspaceHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtWorkspace/ExtWorkspaceHostCapability")<
    ExtWorkspaceHostCapability,
    {
      asWorkspaceRelativePath(uri: string): string
    }
  >()
{}

export const layerAsIs = Layer.succeed(ExtWorkspaceHostCapability, {
  asWorkspaceRelativePath: (uri: string) => uri
})
