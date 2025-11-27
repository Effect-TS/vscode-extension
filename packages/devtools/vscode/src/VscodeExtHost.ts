import type * as ExtCommand from "@effect/devtools-shared/core/ExtCommand"
import type * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import type * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import type * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import { htmlString as TracerWebViewHtml } from "@effect/devtools-shared/webviews/tracer.generated"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Schema from "effect/Schema"
import * as vscode from "vscode"
import * as VsCode_ from "./VsCode.ts"

export const VscodeExtHost = Layer.scoped(
  ExtHost.ExtHost,
  Effect.gen(function*() {
    const hostScope = yield* Effect.scope
    const context = yield* Effect.context<VsCode_.VsCodeContext>()

    const registerCommand = (
      command: ExtCommand.AnyWithProps,
      handler: ExtCommand.HandlerNoContext<string>
    ) => {
      return VsCode_.registerCommand(command._id, (arg: any) =>
        Schema.decodeUnknown(command.payloadSchema)(arg).pipe(
          Effect.flatMap((args) => handler(args))
        )).pipe(Effect.provide(context))
    }

    const executeCommand = (
      command: ExtCommand.AnyWithProps,
      arg: any
    ) => {
      return Schema.encodeUnknown(command.payloadSchema)(arg).pipe(
        Effect.flatMap((args) => VsCode_.executeCommand(command._id, ...args))
      )
    }

    const registerTreeView = (
      treeView: ExtTreeView.AnyWithProps,
      builder: ExtTreeView.ExtTreeViewBuilder<any, never>
    ) => {
      return Layer.launch(
        VsCode_.treeDataProvider<any>(treeView._id)(
          Effect.fn("registerTreeView")(function*(refresh) {
            const myProvider = yield* builder(refresh)

            return {
              children: myProvider.children,
              treeItem: (valueItem) =>
                myProvider.treeItem(valueItem).pipe(
                  Effect.map((item) => {
                    const vscodeItem = new vscode.TreeItem(item.label)
                    vscodeItem.id = item.id
                    vscodeItem.label = item.label
                    vscodeItem.description = item.description ?? ""
                    switch (item.collapsibleState) {
                      case "none":
                        vscodeItem.collapsibleState = vscode.TreeItemCollapsibleState.None
                        break
                      case "collapsed":
                        vscodeItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed
                        break
                      case "expanded":
                        vscodeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
                        break
                    }
                    vscodeItem.contextValue = valueItem._tag
                    if (item.icon) vscodeItem.iconPath = new vscode.ThemeIcon(item.icon.name)
                    if (item.command) {
                      const itemCommand = item.command
                      vscodeItem.command = {
                        command: itemCommand.command._id,
                        title: itemCommand.command.title,
                        arguments: itemCommand.arguments.map((arg) =>
                          Schema.encodeUnknownSync(itemCommand.command.payloadSchema)(arg)
                        )
                      }
                    }
                    return vscodeItem
                  })
                )
            }
          })
        )
      ).pipe(Effect.provide(context), Effect.forkIn(hostScope))
    }

    const registerWebView = (
      _webView: ExtWebView.AnyWithProps,
      _builder: ExtWebView.ExtWebViewBuilder<never>
    ) => {
      return VsCode_.registerWebview(_webView._id, () =>
        Effect.gen(function*() {
          const view = yield* VsCode_.Webview
          view.webview.html = ({
            "tracer": TracerWebViewHtml
          })[_webView.type] || "unknown webview type " + _webView.type
          view.webview.options = {
            enableScripts: true,
            localResourceRoots: []
          }

          const mailbox = yield* Effect.acquireRelease(
            Mailbox.make<unknown>(),
            (mailbox) => mailbox.shutdown
          )

          yield* VsCode_.listenFork(
            view.webview.onDidReceiveMessage,
            (_message: unknown) => mailbox.offer(_message)
          )

          const request = (message: unknown) => VsCode_.thenable(() => view.webview.postMessage(message))

          yield* _builder(request, mailbox)
        }), { webviewOptions: { retainContextWhenHidden: true } }).pipe(
          Effect.asVoid,
          Effect.provide(context)
        )
    }

    const revealFileLineColumnRange = (
      path: string,
      line: number,
      column: number,
      endLine: number,
      endColumn: number
    ) => {
      return VsCode_.revealFile(path, new vscode.Range(line, column, endLine, endColumn)).pipe(Effect.provide(context))
    }

    const asWorkspaceRelativePath = (uri: string) => {
      return vscode.workspace.asRelativePath(VsCode_.vscodeUriFromPath(uri))
    }

    const setVariable = (id: string, value: any) => {
      return VsCode_.executeCommand("setContext", id, value).pipe(Effect.provide(context))
    }

    const registerConfig = (_config: ExtConfig.AnyWithProps) => {
      return Effect.void
    }

    const readConfig = (config: ExtConfig.AnyWithProps) => {
      const [name, ...namespace] = Array.reverse(config._id.split("."))
      return VsCode_.configWithDefault(Array.reverse(namespace).join("."), name, config.defaultValue).pipe(
        Effect.provide(context)
      )
    }

    return {
      registerConfig,
      registerCommand,
      executeCommand,
      registerTreeView,
      registerWebView,
      readConfig,
      revealFileLineColumnRange,
      asWorkspaceRelativePath,
      setVariable
    }
  })
)
