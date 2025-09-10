import type * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as LogLevel from "effect/LogLevel"
import * as Option from "effect/Option"
import * as Runtime from "effect/Runtime"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"

export class VsCodeContext extends Context.Tag("vscode/ExtensionContext")<
  VsCodeContext,
  vscode.ExtensionContext
>() {}

export const thenable = <A>(f: () => Thenable<A>) =>
  Effect.async<A>((resume) => {
    f().then((_) => resume(Effect.succeed(_)))
  })

export const thenableCatch = <A, E>(f: () => Thenable<A>, onError: (error: unknown) => E) =>
  Effect.tryPromise({
    try: () => f(),
    catch: onError
  })

export const dismissable = <A>(
  f: () => Thenable<A | undefined>
): Effect.Effect<A, Cause.NoSuchElementException> => thenable(f).pipe(Effect.flatMap(Effect.fromNullable))

export const executeCommand = <A = unknown>(command: string, ...args: Array<any>) =>
  thenable(() => vscode.commands.executeCommand<A>(command, ...args))

export const executeCommandCatch = <A = unknown>(command: string, ...args: Array<any>) =>
  thenableCatch(() => vscode.commands.executeCommand<A>(command, ...args), (error) => error)

export const registerCommand = <R, E, A>(
  command: string,
  f: (...args: Array<any>) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const context = yield* VsCodeContext
    const runtime = yield* Effect.runtime<R>()
    const run = Runtime.runFork(runtime)

    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args) =>
        f(...args).pipe(
          Effect.catchAllCause(Effect.log),
          Effect.annotateLogs({ command }),
          run
        ))
    )
  })

export const registerTextEditorCommand = <R, E, A>(
  command: string,
  f: (textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, ...args: Array<any>) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const context = yield* VsCodeContext
    const runtime = yield* Effect.runtime<R>()
    const run = Runtime.runFork(runtime)

    context.subscriptions.push(
      vscode.commands.registerTextEditorCommand(command, (textEditor, edit, ...args) =>
        f(textEditor, edit, ...args).pipe(
          Effect.catchAllCause(Effect.log),
          Effect.annotateLogs({ command }),
          run
        ))
    )
  })

export class Webview extends Context.Tag("vscode/Webview")<
  Webview,
  vscode.WebviewView
>() {}

export const registerWebview = <R>(
  id: string,
  f: (
    context: vscode.WebviewViewResolveContext
  ) => Effect.Effect<void, never, Webview | R | Scope.Scope>,
  options?: {
    readonly webviewOptions?: {
      readonly retainContextWhenHidden?: boolean
    }
  }
): Effect.Effect<
  void,
  never,
  Exclude<R, Scope.Scope | Webview> | VsCodeContext
> =>
  Effect.gen(function*() {
    const context = yield* VsCodeContext
    const runtime = yield* Effect.runtime<Exclude<R, Scope.Scope | Webview>>()
    const run = runWithToken(runtime)

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(id, {
        resolveWebviewView(view, context, token) {
          run(
            f(context).pipe(
              Effect.zipRight(Effect.never),
              Effect.scoped,
              Effect.provideService(Webview, view)
            ) as any,
            token
          )
        }
      }, options)
    )
  })

export interface ConfigRef<A> {
  readonly get: Effect.Effect<A>
  readonly changes: Stream.Stream<A>
}

export const config = <A>(
  namespace: string,
  setting: string
): Effect.Effect<ConfigRef<Option.Option<A>>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const get = () => vscode.workspace.getConfiguration(namespace).get<A>(setting)
    const ref = yield* SubscriptionRef.make<Option.Option<A>>(
      Option.fromNullable(get())
    )
    yield* listenFork(vscode.workspace.onDidChangeConfiguration, (_) =>
      SubscriptionRef.set(ref, Option.fromNullable(get())))
    return {
      get: SubscriptionRef.get(ref),
      changes: Stream.changes(ref.changes)
    }
  })

export const configWithDefault = <A>(
  namespace: string,
  setting: string,
  defaultValue: A
): Effect.Effect<ConfigRef<A>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const get = () => vscode.workspace.getConfiguration(namespace).get<A>(setting)
    const ref = yield* SubscriptionRef.make(get() ?? defaultValue)
    yield* listenFork(vscode.workspace.onDidChangeConfiguration, (_) => SubscriptionRef.set(ref, get() ?? defaultValue))
    return {
      get: SubscriptionRef.get(ref),
      changes: Stream.changes(ref.changes)
    }
  })

export const listen = <A, R>(
  event: vscode.Event<A>,
  f: (data: A) => Effect.Effect<void, never, R>
): Effect.Effect<never, never, R> =>
  Effect.flatMap(Effect.runtime<R>(), (runtime) =>
    Effect.async<never>((_resume) => {
      const run = Runtime.runFork(runtime)
      const d = event((data) =>
        run(
          Effect.catchAllCause(f(data), (_) => Effect.log("unhandled defect in event listener", _))
        )
      )
      return Effect.sync(() => {
        d.dispose()
      })
    }))

export const registerUriHandler = <R>(
  f: (uri: vscode.Uri) => Effect.Effect<void, never, R>
) =>
  Effect.forkScoped(Effect.flatMap(Effect.runtime<R>(), (runtime) =>
    Effect.async<never>((_resume) => {
      const run = Runtime.runPromise(runtime)
      const d = vscode.window.registerUriHandler({
        handleUri: (uri: vscode.Uri) =>
          run(
            Effect.catchAllCause(f(uri), (_) => Effect.log("unhandled defect in event listener", _))
          )
      })
      return Effect.sync(() => {
        d.dispose()
      })
    })))

export const registerHoverProvider = <R>(
  selector: vscode.DocumentSelector,
  f: (
    document: vscode.TextDocument,
    position: vscode.Position
  ) => Effect.Effect<vscode.Hover | null | undefined, never, R>
) =>
  Effect.forkScoped(Effect.flatMap(Effect.runtime<R>(), (runtime) =>
    Effect.async<never>((_resume) => {
      const run = Runtime.runPromise(runtime)
      const d = vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position) =>
          run(
            Effect.catchAllCause(f(document, position), (_) =>
              Effect.log("unhandled defect in event listener", _).pipe(Effect.as(null)))
          )
      })
      return Effect.sync(() => {
        d.dispose()
      })
    })))

export const listenStream = <A>(event: vscode.Event<A>): Stream.Stream<A> =>
  Stream.async<A>((emit) => {
    const d = event((data) => emit.single(data))
    return Effect.sync(() => {
      d.dispose()
    })
  })

export const listenFork = <A, R>(
  event: vscode.Event<A>,
  f: (data: A) => Effect.Effect<void, never, R>
) => Effect.forkScoped(listen(event, f))

export interface Emitter<A> {
  readonly event: vscode.Event<A>
  readonly fire: (data: A) => Effect.Effect<void>
}

export const emitter = <A>() =>
  Effect.gen(function*() {
    const emitter = new vscode.EventEmitter<A>()
    yield* Effect.addFinalizer(() => Effect.sync(() => emitter.dispose()))
    const fire = (data: A) => Effect.sync(() => emitter.fire(data))
    return {
      event: emitter.event,
      fire
    } as Emitter<A>
  })

export const emitterOptional = <A>() =>
  Effect.map(emitter<A | null | undefined | void>(), (emitter) => ({
    ...emitter,
    fire: (data: Option.Option<A>) => emitter.fire(Option.getOrUndefined(data))
  }))

export interface TreeDataProvider<A> {
  readonly treeItem: (element: A) => Effect.Effect<vscode.TreeItem>
  readonly children: (
    element: Option.Option<A>
  ) => Effect.Effect<Option.Option<Array<A>>>
  readonly parent?: (element: A) => Effect.Effect<Option.Option<A>>
  readonly resolve?: (
    item: vscode.TreeItem,
    element: A
  ) => Effect.Effect<Option.Option<vscode.TreeItem>>
}

export const TreeDataProvider = <A>(_: TreeDataProvider<A>) => _

export const treeDataProvider = <A>(name: string) =>
<R, E>(
  create: (
    refresh: (data: Option.Option<A | Array<A>>) => Effect.Effect<void>
  ) => Effect.Effect<TreeDataProvider<A>, E, R>
): Layer.Layer<never, E, Exclude<R, Scope.Scope> | VsCodeContext> =>
  Effect.gen(function*() {
    const onChange = yield* emitterOptional<A | Array<A>>()
    const provider = yield* create(onChange.fire)
    const vscodeProvider: vscode.TreeDataProvider<A> = {
      onDidChangeTreeData: onChange.event,
      getTreeItem(element) {
        return Effect.runPromise(provider.treeItem(element))
      },
      getChildren(element) {
        return Effect.runPromise(
          Effect.map(
            provider.children(Option.fromNullable(element)),
            Option.getOrUndefined
          )
        )
      },
      getParent: provider.parent
        ? (element) =>
          Effect.runPromise(
            Effect.map(provider.parent!(element), Option.getOrUndefined)
          )
        : undefined,
      resolveTreeItem: provider.resolve
        ? (item, element, token) =>
          runWithTokenDefault(
            Effect.map(
              provider.resolve!(item, element),
              Option.getOrUndefined
            ),
            token
          )
        : undefined
    }
    const context = yield* VsCodeContext
    context.subscriptions.push(
      vscode.window.createTreeView(name, {
        treeDataProvider: vscodeProvider,
        showCollapseAll: true
      })
    )
  }).pipe(Layer.scopedDiscard)

export const runWithToken = <R>(runtime: Runtime.Runtime<R>) => {
  const runCallback = Runtime.runCallback(runtime)
  return <E, A>(
    effect: Effect.Effect<A, E, R>,
    token: vscode.CancellationToken
  ) =>
    new Promise<A | undefined>((resolve) => {
      const cancel = runCallback(effect, {
        onExit: (exit) => {
          tokenDispose.dispose()

          if (exit._tag === "Success") {
            resolve(exit.value)
          } else {
            resolve(undefined)
          }
        }
      })
      const tokenDispose = token.onCancellationRequested(() => {
        cancel()
      })
    })
}
export const runWithTokenDefault = runWithToken(Runtime.defaultRuntime)

export const launch = <E>(layer: Layer.Layer<never, E, VsCodeContext>) =>
  Effect.gen(function*() {
    const context = yield* VsCodeContext
    const scope = yield* Scope.make()
    context.subscriptions.push({
      dispose: () => Effect.runFork(Scope.close(scope, Exit.void))
    })
    yield* Layer.buildWithScope(layer, scope)
  }).pipe(Effect.catchAllCause(Effect.logFatal))

export const logger = (name: string) =>
  Logger.replaceScoped(
    Logger.defaultLogger,
    Effect.gen(function*() {
      const channel = yield* Effect.acquireRelease(
        Effect.sync(() => vscode.window.createOutputChannel(name, { log: true })),
        (channel) => Effect.sync(() => channel.dispose())
      )
      return Logger.make((options) => {
        const message = Logger.logfmtLogger.log(options)

        switch (options.logLevel) {
          case LogLevel.Trace:
            channel.trace(message)
            break
          case LogLevel.Debug:
            channel.debug(message)
            break
          case LogLevel.Warning:
            channel.warn(message)
            break
          case LogLevel.Error:
          case LogLevel.Fatal:
            channel.error(message)
            break
          default:
            channel.info(message)
            break
        }
      })
    })
  )

export class VsCodeDebugSession extends Context.Tag("vscode/DebugSession")<
  VsCodeDebugSession,
  vscode.DebugSession
>() {}

export const debugRequest = <A = unknown>(
  command: string,
  args?: any
): Effect.Effect<A, never, VsCodeDebugSession> =>
  Effect.flatMap(VsCodeDebugSession, (session) => thenable(() => session.customRequest(command, args)))

export const vscodeUriFromPath = (path: string) => {
  const pathLowered = path.toLowerCase()
  if (
    pathLowered.startsWith("file://") || pathLowered.startsWith("http://") || pathLowered.startsWith("https://")
  ) return vscode.Uri.parse(path, false)
  return vscode.Uri.file(path)
}

export const revealFile = (
  path: string,
  selection?: vscode.Range
) =>
  thenable(() => vscode.workspace.openTextDocument(vscodeUriFromPath(path))).pipe(
    Effect.flatMap((doc) => thenable(() => vscode.window.showTextDocument(doc, { selection })))
  )

export const revealCode = (
  content: string,
  language: string,
  selection?: vscode.Range
) =>
  thenable(() => vscode.workspace.openTextDocument({ language, content })).pipe(
    Effect.flatMap((doc) => thenable(() => vscode.window.showTextDocument(doc, { selection })))
  )

export const revealFileWithSelection = (
  path: string,
  selection: vscode.Range
) => revealFile(path, selection)

export const isExtensionInstalled = (extension: string) =>
  Effect.sync(() => {
    const ext = vscode.extensions.getExtension(extension)
    return ext && ext.isActive
  })
