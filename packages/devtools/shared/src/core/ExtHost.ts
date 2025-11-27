import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import type * as ExtCommand from "./ExtCommand.ts"
import type * as ExtConfig from "./ExtConfig.ts"
import type * as ExtTreeView from "./ExtTreeView.ts"
import type * as ExtWebView from "./ExtWebView.ts"

export class ExtHost extends Context.Tag("ExtHost")<ExtHost, {
  registerCommand(
    command: ExtCommand.AnyWithProps,
    handler: ExtCommand.HandlerNoContext<string>
  ): Effect.Effect<void, never, never>
  executeCommand(
    command: ExtCommand.AnyWithProps,
    payloadEncoded: any
  ): Effect.Effect<any, any, never>
  registerTreeView(
    treeView: ExtTreeView.AnyWithProps,
    builder: ExtTreeView.ExtTreeViewBuilder<any, never>
  ): Effect.Effect<void, never, never>
  registerWebView(
    webView: ExtWebView.AnyWithProps,
    builder: ExtWebView.ExtWebViewBuilder<Scope.Scope>
  ): Effect.Effect<void, never, never>
  setVariable<Type>(id: string, value: Type): Effect.Effect<void, never, never>
  revealFileLineColumnRange(
    path: string,
    line: number,
    column: number,
    endLine: number,
    endColumn: number
  ): Effect.Effect<void, never, never>
  asWorkspaceRelativePath(uri: string): string
  registerConfig(config: ExtConfig.AnyWithProps): Effect.Effect<void, never, never>
  readConfig(confing: ExtConfig.AnyWithProps): Effect.Effect<ExtConfig.ConfigRef<any>, never, Scope.Scope>
}>() {
}

export const registerConfig = <A extends ExtConfig.AnyWithProps>(
  config: A
): Layer.Layer<ExtConfig.MissingConfig<ExtConfig.Id<A>>> =>
  Layer.effectDiscard(
    Effect.gen(function*() {
      const host = yield* ExtHost
      yield* host.registerConfig(config)
    })
  ) as any
