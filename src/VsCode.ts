import {
  Cause,
  Context,
  Effect,
  Either,
  Exit,
  Layer,
  LogLevel,
  Logger,
  Option,
  Runtime,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import * as vscode from "vscode"

export const VsCodeContext = Context.Tag<vscode.ExtensionContext>(
  "vscode/ExtensionContext",
)

export const thenable = <A>(f: () => Thenable<A>) =>
  Effect.async<never, never, A>(resume => {
    f().then(_ => resume(Effect.succeed(_)))
  })

export const dismissable = <A>(
  f: () => Thenable<A | undefined>,
): Effect.Effect<never, Cause.NoSuchElementException, A> =>
  thenable(f).pipe(Effect.flatMap(Effect.fromNullable))

export const executeCommand = (command: string, ...args: Array<any>) =>
  thenable(() => vscode.commands.executeCommand(command, ...args))

export const registerCommand = <R, E, A>(
  command: string,
  f: (...args: Array<any>) => Effect.Effect<R, E, A>,
) =>
  Effect.gen(function* (_) {
    const context = yield* _(VsCodeContext)
    const runtime = yield* _(Effect.runtime<R>())
    const run = Runtime.runFork(runtime)

    context.subscriptions.push(
      vscode.commands.registerCommand(command, (...args) =>
        f(...args).pipe(
          Effect.catchAllCause(Effect.log),
          Effect.annotateLogs({ command }),
          run,
        ),
      ),
    )
  })

export interface ConfigRef<A> {
  readonly get: Effect.Effect<never, never, A>
  readonly changes: Stream.Stream<never, never, A>
}

export const config = <A>(
  namespace: string,
  setting: string,
): Effect.Effect<Scope.Scope, never, ConfigRef<Option.Option<A>>> =>
  Effect.gen(function* (_) {
    const get = () =>
      vscode.workspace.getConfiguration(namespace).get<A>(setting)
    const ref = yield* _(
      SubscriptionRef.make<Option.Option<A>>(Option.fromNullable(get())),
    )
    yield* _(
      listenFork(vscode.workspace.onDidChangeConfiguration, _ =>
        SubscriptionRef.set(ref, Option.fromNullable(get())),
      ),
    )
    return {
      get: SubscriptionRef.get(ref),
      changes: Stream.changes(ref.changes),
    }
  })

export const configWithDefault = <A>(
  namespace: string,
  setting: string,
  defaultValue: A,
): Effect.Effect<Scope.Scope, never, ConfigRef<A>> =>
  Effect.gen(function* (_) {
    const get = () =>
      vscode.workspace.getConfiguration(namespace).get<A>(setting)
    const ref = yield* _(SubscriptionRef.make(get() ?? defaultValue))
    yield* _(
      listenFork(vscode.workspace.onDidChangeConfiguration, _ =>
        SubscriptionRef.set(ref, get() ?? defaultValue),
      ),
    )
    return {
      get: SubscriptionRef.get(ref),
      changes: Stream.changes(ref.changes),
    }
  })

export const listen = <A, R>(
  event: vscode.Event<A>,
  f: (data: A) => Effect.Effect<R, never, void>,
): Effect.Effect<R, never, never> =>
  Effect.flatMap(Effect.runtime<R>(), runtime =>
    Effect.async<never, never, never>(_resume => {
      const run = Runtime.runFork(runtime)
      const d = event(data =>
        run(
          Effect.catchAllCause(f(data), _ =>
            Effect.log("unhandled defect in event listener", _),
          ),
        ),
      )
      return Effect.sync(() => {
        d.dispose()
      })
    }),
  )

export const listenStream = <A>(
  event: vscode.Event<A>,
): Stream.Stream<never, never, A> =>
  Stream.asyncInterrupt<never, never, A>(emit => {
    const d = event(data => emit.single(data))
    return Either.left(
      Effect.sync(() => {
        d.dispose()
      }),
    )
  })

export const listenFork = <A, R>(
  event: vscode.Event<A>,
  f: (data: A) => Effect.Effect<R, never, void>,
) => Effect.forkScoped(listen(event, f))

export interface Emitter<A> {
  readonly event: vscode.Event<A>
  readonly fire: (data: A) => Effect.Effect<never, never, void>
}

export const emitter = <A>() =>
  Effect.gen(function* (_) {
    const emitter = new vscode.EventEmitter<A>()
    yield* _(Effect.addFinalizer(() => Effect.sync(() => emitter.dispose())))
    const fire = (data: A) => Effect.sync(() => emitter.fire(data))
    return {
      event: emitter.event,
      fire,
    } as Emitter<A>
  })

export const emitterOptional = <A>() =>
  Effect.map(emitter<A | null | undefined | void>(), emitter => ({
    ...emitter,
    fire: (data: Option.Option<A>) => emitter.fire(Option.getOrUndefined(data)),
  }))

export interface TreeDataProvider<A> {
  readonly treeItem: (
    element: A,
  ) => Effect.Effect<never, never, vscode.TreeItem>
  readonly children: (
    element: Option.Option<A>,
  ) => Effect.Effect<never, never, Option.Option<Array<A>>>
  readonly parent?: (
    element: A,
  ) => Effect.Effect<never, never, Option.Option<A>>
  readonly resolve?: (
    item: vscode.TreeItem,
    element: A,
  ) => Effect.Effect<never, never, Option.Option<vscode.TreeItem>>
}

export const TreeDataProvider = <A>(_: TreeDataProvider<A>) => _

export const treeDataProvider =
  <A>(name: string) =>
  <R, E>(
    create: (
      refresh: (
        data: Option.Option<A | Array<A>>,
      ) => Effect.Effect<never, never, void>,
    ) => Effect.Effect<R, E, TreeDataProvider<A>>,
  ): Layer.Layer<Exclude<R, Scope.Scope> | vscode.ExtensionContext, E, never> =>
    Effect.gen(function* (_) {
      const onChange = yield* _(emitterOptional<A | Array<A>>())
      const provider = yield* _(create(onChange.fire))
      const vscodeProvider: vscode.TreeDataProvider<A> = {
        onDidChangeTreeData: onChange.event,
        getTreeItem(element) {
          return Effect.runPromise(provider.treeItem(element))
        },
        getChildren(element) {
          return Effect.runPromise(
            Effect.map(
              provider.children(Option.fromNullable(element)),
              Option.getOrUndefined,
            ),
          )
        },
        getParent: provider.parent
          ? element =>
              Effect.runPromise(
                Effect.map(provider.parent!(element), Option.getOrUndefined),
              )
          : undefined,
        resolveTreeItem: provider.resolve
          ? (item, element, token) =>
              runWithTokenDefault(
                Effect.map(
                  provider.resolve!(item, element),
                  Option.getOrUndefined,
                ),
                token,
              )
          : undefined,
      }
      const context = yield* _(VsCodeContext)
      context.subscriptions.push(
        vscode.window.createTreeView(name, {
          treeDataProvider: vscodeProvider,
          showCollapseAll: true,
        }),
      )
    }).pipe(Layer.scopedDiscard)

export const runWithToken = <R>(runtime: Runtime.Runtime<R>) => {
  const runCallback = Runtime.runCallback(runtime)
  return <E, A>(
    effect: Effect.Effect<R, E, A>,
    token: vscode.CancellationToken,
  ) =>
    new Promise<A | undefined>(resolve => {
      const cancel = runCallback(effect, exit => {
        tokenDispose.dispose()

        if (exit._tag === "Success") {
          resolve(exit.value)
        } else {
          resolve(undefined)
        }
      })
      const tokenDispose = token.onCancellationRequested(() => {
        cancel()
      })
    })
}
export const runWithTokenDefault = runWithToken(Runtime.defaultRuntime)

export const launch = <E>(
  layer: Layer.Layer<vscode.ExtensionContext, E, never>,
) =>
  Effect.gen(function* (_) {
    const context = yield* _(VsCodeContext)
    const scope = yield* _(Scope.make())
    context.subscriptions.push({
      dispose: () => Effect.runFork(Scope.close(scope, Exit.unit)),
    })
    yield* _(Layer.buildWithScope(layer, scope))
  }).pipe(Effect.catchAllCause(Effect.logFatal))

export const logger = (name: string) =>
  Logger.replaceScoped(
    Logger.defaultLogger,
    Effect.gen(function* (_) {
      const channel = yield* _(
        Effect.acquireRelease(
          Effect.sync(() =>
            vscode.window.createOutputChannel(name, { log: true }),
          ),
          channel => Effect.sync(() => channel.dispose()),
        ),
      )
      return Logger.make(options => {
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
    }),
  )

export interface VsCodeDebugSession {
  readonly _: unique symbol
}
export const VsCodeDebugSession = Context.Tag<
  VsCodeDebugSession,
  vscode.DebugSession
>("vscode/DebugSession")

export const debugRequest = <A = unknown>(
  command: string,
  args?: any,
): Effect.Effect<VsCodeDebugSession, never, A> =>
  Effect.flatMap(VsCodeDebugSession, session =>
    thenable(() => session.customRequest(command, args)),
  )
