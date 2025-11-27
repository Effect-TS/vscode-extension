import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as ExtCommand from "./core/ExtCommand.ts"
import * as ExtHost from "./core/ExtHost.ts"
import type * as ExtTreeView from "./core/ExtTreeView.ts"
import * as ExtWebView from "./core/ExtWebView.ts"
import * as ExtWhenEvaluator from "./core/ExtWhenEvaluator.ts"
import * as TreeWebView from "./webviews/tree.generated.ts"

export type Keys<V extends ExtTreeView.AnyWithProps, C extends ExtCommand.AnyWithProps> = ExtTreeView.Item<V> extends
  { _tag: infer K } ?
  (K extends infer X ? (Extract<ExtTreeView.Item<V>, { _tag: X }> extends ExtCommand.PayloadEncoded<C> ? X
      : never) :
    never)
  : never

export class ExtTreeAsExtWebView extends Effect.Service<ExtTreeAsExtWebView>()("effect-chrome/ExtTreeAsExtWebView", {
  scoped: Effect.gen(function*() {
    const titleActions = new Map<string, Array<ExtCommand.AnyWithProps>>()
    const inlineActions = new Map<string, Array<{ command: ExtCommand.AnyWithProps; keys: Array<string> }>>()
    const whenEvaluator = yield* ExtWhenEvaluator.ExtWhenEvaluator
    const scope = yield* Effect.scope
    const extHost = yield* ExtHost.ExtHost

    function treeViewNavigationAction<
      V extends ExtTreeView.AnyWithProps,
      C extends ExtCommand.AnyWithProps
    >(
      treeView: V,
      command: C
    ): Layer.Layer<
      never,
      never,
      ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
    > {
      return Layer.effectDiscard(
        Effect.sync(() => titleActions.set(treeView._id, [...titleActions.get(treeView._id) || [], command]))
      )
    }

    function treeViewInlineAction<
      V extends ExtTreeView.AnyWithProps,
      C extends ExtCommand.AnyWithProps
    >(
      treeView: V,
      _command: C
    ) {
      return <
        K extends Array<Keys<V, C>>
      >(
        ..._keys: K
      ): Layer.Layer<
        never,
        never,
        | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>>
        | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
      > =>
        Layer.effectDiscard(
          Effect.sync(() =>
            inlineActions.set(treeView._id, [...inlineActions.get(treeView._id) || [], {
              command: _command,
              keys: _keys as Array<string>
            }])
          )
        )
    }

    function toWebview(
      treeView: ExtTreeView.AnyWithProps,
      builder: ExtTreeView.ExtTreeViewBuilder<any, never>
    ) {
      const webView = ExtWebView.make(treeView._id, {
        ...treeView,
        type: "tree"
      })

      const webBuilder: ExtWebView.ExtWebViewBuilder<Scope.Scope> = (send, queue) => {
        return Effect.gen(function*() {
          // request need to encode and send
          const request = (message: TreeWebView.InMessage) =>
            Schema.encodeUnknown(TreeWebView.InMessage)(message).pipe(
              Effect.flatMap(send),
              Effect.ignoreLogged
            )

          // start the source and provide the refresh function
          const source = yield* builder(() => request(new TreeWebView.InvalidatedIds({ itemIds: Option.none() })))

          function resolveItemByPath(itemPath: TreeWebView.ItemPath) {
            return Effect.gen(function*() {
              const currentPath = itemPath.path.slice(0)
              let currentParent: Option.Option<any> = Option.none()
              while (currentPath.length > 0) {
                // get the childrens of the current parent
                const childrens = yield* source.children(currentParent)
                if (Option.isNone(childrens)) return Option.none()
                // find the children with the id
                const id = currentPath.shift()!
                const foundChild = yield* Effect.findFirst(
                  childrens.value,
                  (child) => source.treeItem(child).pipe(Effect.map((_) => _.id === id))
                )
                if (Option.isNone(foundChild)) return Option.none()
                currentParent = foundChild
              }
              return currentParent
            })
          }

          // register the handlers
          const extActions = titleActions.get(webView._id) || []
          const streams = extActions.map((action) =>
            whenEvaluator.evaluate(action.enablement).pipe(
              Effect.map((_) => _.changes),
              Stream.unwrap,
              Stream.map((enabled) =>
                new TreeWebView.TitleAction({
                  id: action._id,
                  enabled,
                  label: action.title,
                  icon: Option.fromNullable(action.icon?.name)
                })
              )
            )
          )

          const requestActions = yield* Mailbox.make<void>()
          yield* requestActions.offer(undefined)
          yield* Stream.zipLatestAll(Mailbox.toStream(requestActions), ...streams).pipe(
            Stream.mapEffect(([_, ...actions]) => request(new TreeWebView.TitleActionsInfo({ actions }))),
            Stream.runDrain,
            Effect.tapErrorCause(Effect.logError),
            Effect.forkIn(scope)
          )

          const loadingRef = yield* SubscriptionRef.make(0)
          const withLoading = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
            return Effect.acquireUseRelease(
              SubscriptionRef.update(loadingRef, (count) => count + 1),
              () => effect,
              () => SubscriptionRef.update(loadingRef, (count) => count - 1)
            )
          }
          yield* loadingRef.changes.pipe(
            Stream.debounce(100),
            Stream.mapEffect(() => loadingRef.get),
            Stream.map((count) => request(new TreeWebView.LoadingInfo({ isLoading: count > 0 }))),
            Stream.runDrain,
            Effect.forkIn(scope)
          )

          // register handler
          yield* queue.take.pipe(
            Effect.flatMap((encoded) =>
              Effect.gen(function*() {
                const _ = yield* Schema.decodeUnknown(TreeWebView.OutMessage)(encoded)
                switch (_._tag) {
                  case "Initialized": {
                    yield* request(new TreeWebView.InvalidatedIds({ itemIds: Option.none() }))
                    return yield* requestActions.offer(undefined)
                  }
                  case "RequestTreeItemChildren": {
                    const children = _.itemPath.path.length === 0
                      ? yield* source.children(Option.none())
                      : yield* resolveItemByPath(_.itemPath).pipe(Effect.flatMap(Option.match({
                        onNone: () => Effect.succeedNone,
                        onSome: (item) => source.children(Option.some(item))
                      })))

                    if (Option.isNone(children)) {
                      return yield* request(
                        new TreeWebView.TreeItemChildrenInfo({ itemPath: _.itemPath, children: [] })
                      )
                    } else {
                      const ids = yield* Effect.forEach(
                        children.value,
                        (child) => source.treeItem(child).pipe(Effect.map((_) => _.id))
                      )
                      return yield* request(
                        new TreeWebView.TreeItemChildrenInfo({ itemPath: _.itemPath, children: ids })
                      )
                    }
                    return
                  }
                  case "RequestTreeItemInfo": {
                    const maybeItem = yield* resolveItemByPath(_.itemPath)
                    if (Option.isSome(maybeItem)) {
                      const itemInfo = yield* source.treeItem(maybeItem.value)
                      return yield* request(
                        new TreeWebView.TreeItemInfo({
                          itemPath: _.itemPath,
                          icon: Option.fromNullable(itemInfo.icon?.name),
                          label: itemInfo.label,
                          description: itemInfo.description ?? "",
                          collapsibleState: itemInfo.collapsibleState,
                          hasCommand: itemInfo.command !== undefined,
                          inlineActions: (inlineActions.get(webView._id) || []).filter((action) =>
                            action.keys.indexOf(maybeItem.value._tag) !== -1
                          ).map((action) => ({
                            commandId: action.command._id,
                            title: action.command.title,
                            icon: action.command.icon?.name ?? ""
                          }))
                        })
                      )
                    }
                    return
                  }
                  case "RequestTitleActions": {
                    return yield* requestActions.offer(undefined)
                  }
                  case "ExecuteTitleAction": {
                    return yield* pipe(
                      Array.findFirst(extActions, (c) => c._id === _.id),
                      Effect.flatMap((command) => extHost.executeCommand(command, undefined))
                    )
                  }
                  case "ExecuteItemCommand": {
                    return yield* pipe(
                      resolveItemByPath(_.itemPath),
                      Effect.flatten,
                      Effect.flatMap((item) => source.treeItem(item)),
                      Effect.flatMap((item) =>
                        item.command ?
                          extHost.executeCommand(
                            item.command.command as any,
                            ...item.command.arguments
                          ) :
                          Effect.void
                      )
                    )
                  }
                  case "ExecuteItemAction": {
                    return yield* pipe(
                      resolveItemByPath(_.itemPath),
                      Effect.flatten,
                      Effect.flatMap((item) =>
                        pipe(
                          inlineActions.get(webView._id) || [],
                          Array.findFirst((action) => action.command._id === _.commandId),
                          Effect.flatMap((action) => extHost.executeCommand(action.command, item))
                        )
                      )
                    )
                  }
                }
              }).pipe(withLoading, Effect.ignoreLogged)
            ),
            Effect.forever,
            Effect.forkScoped
          )
        })
      }

      return [webView, webBuilder] as const
    }
    return {
      toWebview,
      treeViewNavigationAction,
      treeViewInlineAction
    }
  })
}) {}

export const layer = Layer.unwrapEffect(Effect.gen(function*() {
  const treeWebView = yield* ExtTreeAsExtWebView
  const extHost = yield* ExtHost.ExtHost

  return Layer.succeed(ExtHost.ExtHost, {
    ...extHost,
    registerTreeView(treeView, builder) {
      const [webView, webBuilder] = treeWebView.toWebview(treeView, builder)

      return extHost.registerWebView(webView, webBuilder)
    }
  })
})).pipe(
  Layer.provideMerge(ExtTreeAsExtWebView.Default)
)
