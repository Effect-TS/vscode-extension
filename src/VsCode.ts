import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Option,
  Runtime,
  Scope,
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

export const registerCommand = <R, E, A>(
  command: string,
  f: (...args: Array<any>) => Effect.Effect<R, E, A>,
) =>
  Effect.gen(function* (_) {
    const context = yield* _(VsCodeContext)
    const runtime = yield* _(Effect.runtime<R>())
    const run = Runtime.runFork(runtime)

    context.subscriptions.push(
      vscode.commands.registerCommand(command, args =>
        f(...args).pipe(
          Effect.catchAllCause(Effect.log),
          Effect.annotateLogs({ command }),
          run,
        ),
      ),
    )
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
