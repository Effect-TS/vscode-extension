import "@vscode-elements/elements/dist/bundled"
import { Atom, useAtomSet, useAtomSuspense } from "@effect-atom/atom-react"
import * as Reactivity from "@effect/experimental/Reactivity"
import type { VscodeTreeItem } from "@vscode-elements/elements"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as React from "react"
import { useInView } from "react-intersection-observer"
import * as WebviewMessaging from "../WebviewMessaging.ts"
import type { TitleAction } from "./messages.ts"
import {
  ExecuteItemAction,
  ExecuteItemCommand,
  ExecuteTitleAction,
  Initialized,
  InMessage,
  ItemPath,
  OutMessage,
  RequestTreeItemChildren,
  RequestTreeItemInfo,
  TitleActionsInfo,
  TreeItemChildrenInfo,
  TreeItemInfo
} from "./messages.ts"

const styles = {
  toolbarContainer: {},
  treeItemDescription: {
    marginLeft: "6px",
    opacity: 0.7
  },
  treeContainer: {
    flex: 1,
    minHeight: "100px"
  },
  treeItemLoading: {
    opacity: 0.5,
    fontStyle: "italic"
  },
  treeItemLabelContainer: {
    display: "flex",
    flexDirection: "row" as const
  },
  treeItemLabelName: {
    flex: 1
  },
  treeItemLabelActions: {
    flex: 0,
    marginRight: "6px"
  }
}

class TreeApp extends Effect.Service<TreeApp>()("TreeApp", {
  dependencies: [WebviewMessaging.layer(Schema.encodeUnknownSync(Initialized)(new Initialized()))],
  scoped: Effect.gen(function*() {
    const { events, postMessage } = yield* WebviewMessaging.WebviewMessaging
    const reactivity = yield* Reactivity.Reactivity
    const openBranches = yield* SubscriptionRef.make<HashSet.HashSet<ItemPath>>(
      HashSet.empty()
    )

    const loadingRef = yield* SubscriptionRef.make<boolean>(false)

    const ofType = <A extends Schema.Schema.AnyNoContext>(
      schema: A
    ): Stream.Stream<Schema.Schema.Type<A>> =>
      Stream.fromPubSub(events).pipe(
        Stream.filterMap(Schema.decodeUnknownOption(schema)),
        Stream.changes
      )

    yield* ofType(InMessage).pipe(
      Stream.mapEffect((_) => {
        switch (_._tag) {
          case "InvalidatedIds": {
            return reactivity.invalidate(
              _.itemIds._tag === "Some" ? _.itemIds.value : ["root"]
            )
          }
          case "LoadingInfo": {
            return SubscriptionRef.set(loadingRef, _.isLoading)
          }
        }
        return Effect.void
      }),
      Stream.runDrain,
      Effect.forkScoped
    )

    const request = (value: OutMessage) =>
      Schema.encodeUnknown(OutMessage)(value).pipe(
        Effect.flatMap(postMessage),
        Effect.ignoreLogged
      )

    const openBranch = (itemPath: ItemPath) =>
      SubscriptionRef.update(openBranches, (branches) => HashSet.add(branches, itemPath))

    const isBranchOpen = (itemPath: ItemPath) => openBranches.changes.pipe(Stream.map((_) => HashSet.has(_, itemPath)))

    const loading = loadingRef.changes

    return {
      ofType,
      request,
      openBranch,
      isBranchOpen,
      loading
    }
  })
}) {}

const atomRuntime = Atom.runtime(TreeApp.Default).pipe(Atom.keepAlive)

const childrensAtom = Atom.family((itemPath: ItemPath) =>
  atomRuntime
    .atom(
      Stream.unwrap(
        Effect.gen(function*() {
          const treeApp = yield* TreeApp
          return treeApp.ofType(TreeItemChildrenInfo).pipe(
            Stream.filter((_) => Equal.equals(_.itemPath, itemPath)),
            Stream.map((_) => _.children),
            Stream.onStart(
              treeApp.request(new RequestTreeItemChildren({ itemPath }))
            )
          )
        })
      )
    )
    .pipe(Atom.withReactivity(["root", ...itemPath.path]))
)

const infoAtom = Atom.family((itemPath: ItemPath) =>
  atomRuntime
    .atom(
      Stream.unwrap(
        Effect.gen(function*() {
          const treeApp = yield* TreeApp
          return treeApp.ofType(TreeItemInfo).pipe(
            Stream.filter((_) => Equal.equals(_.itemPath, itemPath)),
            Stream.onStart(
              treeApp.request(new RequestTreeItemInfo({ itemPath }))
            )
          )
        })
      )
    )
    .pipe(Atom.withReactivity(["root", ...itemPath.path]))
)

const actionsAtom = atomRuntime
  .atom(
    Stream.unwrap(
      Effect.gen(function*() {
        const treeApp = yield* TreeApp
        return treeApp
          .ofType(TitleActionsInfo)
          .pipe(Stream.map((_) => _.actions))
      })
    )
  )
  .pipe(Atom.withReactivity(["root"]))

const executeTitleActionAtom = Atom.family((action: TitleAction) =>
  atomRuntime.fn((_event: any) =>
    Effect.gen(function*() {
      const treeApp = yield* TreeApp
      return yield* treeApp.request(new ExecuteTitleAction({ id: action.id }))
    })
  )
)

const isBranchOpenAtom = Atom.family((itemPath: ItemPath) =>
  atomRuntime
    .atom(
      Stream.unwrap(
        Effect.gen(function*() {
          const treeApp = yield* TreeApp
          return treeApp.isBranchOpen(itemPath)
        })
      )
    )
    .pipe(Atom.withReactivity([...itemPath.path]))
)

function TreeItemChildren({ itemPath }: { itemPath: ItemPath }) {
  const childrens = useAtomSuspense(childrensAtom(itemPath))
  return (
    <>
      {childrens.value.map((item) => (
        <TreeItem
          key={itemPath.path.join("/") + item}
          itemPath={new ItemPath({ path: [...itemPath.path, item] })}
        />
      ))}
    </>
  )
}

const executeItemActionAtom = Atom.family((itemPath: ItemPath) =>
  Atom.family((commandId: string) =>
    atomRuntime.fn((_event: any) =>
      Effect.gen(function*() {
        const treeApp = yield* TreeApp
        _event.detail.originalEvent.stopPropagation()

        yield* treeApp.request(new ExecuteItemAction({ itemPath, commandId }))
      })
    )
  )
)

function TreeItemAction({
  commandId,
  iconName,
  itemPath,
  title
}: {
  iconName: string
  title: string
  itemPath: ItemPath
  commandId: string
}) {
  const executeItemAction = useAtomSet(
    executeItemActionAtom(itemPath)(commandId)
  )
  return (
    <vscode-icon
      name={iconName}
      title={title}
      onvsc-click={executeItemAction}
      action-icon
    />
  )
}

function TreeItem({ itemPath }: { itemPath: ItemPath }) {
  const { inView, ref } = useInView({ trackVisibility: false, triggerOnce: true, threshold: 0, rootMargin: "40px" })
  return inView ? <VisibleTreeItem itemPath={itemPath} /> : (
    <vscode-tree-item ref={ref}>
      <span style={styles.treeItemLoading}>...loading...</span>
    </vscode-tree-item>
  )
}

function VisibleTreeItem({ itemPath }: { itemPath: ItemPath }) {
  const { value: info } = useAtomSuspense(infoAtom(itemPath))
  const icon = info.icon.pipe(
    Option.map((icon) => (
      <>
        <vscode-icon name={icon} slot="icon-branch" />
        <vscode-icon name={icon} slot="icon-branch-opened" />
        <vscode-icon name={icon} slot="icon-leaf" />
      </>
    )),
    Option.getOrNull
  )
  const encodedItemPath = Schema.encodeUnknownSync(Schema.parseJson(ItemPath))(
    itemPath
  )
  const isOpen = useAtomSuspense(isBranchOpenAtom(itemPath))
  let children: React.ReactNode = null
  switch (info.collapsibleState) {
    case "none":
      break
    case "expanded":
    case "collapsed":
      children = isOpen.value ? <TreeItemChildren itemPath={itemPath} /> : (
        <vscode-tree-item>
          <span style={styles.treeItemLoading}>...loading...</span>
        </vscode-tree-item>
      )
      break
  }
  const inlineActions = info.inlineActions.map((action) => (
    <TreeItemAction
      key={action.commandId}
      iconName={action.icon}
      title={action.title}
      itemPath={itemPath}
      commandId={action.commandId}
    />
  ))
  return (
    <vscode-tree-item data-tree-item-path={encodedItemPath}>
      {icon}
      <div style={styles.treeItemLabelContainer}>
        <div style={styles.treeItemLabelActions}>{inlineActions}</div>
        <div style={styles.treeItemLabelName}>
          {info.label}
          <span style={styles.treeItemDescription}>{info.description}</span>
        </div>
      </div>
      {children}
    </vscode-tree-item>
  )
}

const rootPath = new ItemPath({ path: [] })

function TitleActionButton({ action }: { action: TitleAction }) {
  const onClick = useAtomSet(executeTitleActionAtom(action))

  return (
    <vscode-toolbar-button
      onClick={onClick}
      key={action.id}
      title={action.label}
      icon={Option.getOrElse(action.icon, () => "")}
    />
  )
}

function ToolbarContainer() {
  const actions = useAtomSuspense(actionsAtom)
  return (
    <vscode-toolbar-container style={styles.toolbarContainer}>
      {actions.value
        .filter((_) => _.enabled)
        .map((_) => <TitleActionButton key={_.id} action={_} />)}
    </vscode-toolbar-container>
  )
}

const executeItemCommandAtom = atomRuntime.fn(
  (e: CustomEvent<Array<VscodeTreeItem>>) =>
    Effect.gen(function*() {
      const treeApp = yield* TreeApp
      for (const item of e.detail) {
        const encodedItemPath = item.getAttribute("data-tree-item-path")
        if (encodedItemPath) {
          const itemPath = yield* Schema.decodeUnknown(
            Schema.parseJson(ItemPath)
          )(encodedItemPath)
          yield* treeApp.openBranch(itemPath)
          yield* treeApp.request(new ExecuteItemCommand({ itemPath }))
        }
      }
    })
)

function TreeContainer() {
  const executeItemCommand = useAtomSet(executeItemCommandAtom)
  return (
    <vscode-scrollable style={styles.treeContainer}>
      <vscode-tree onvsc-tree-select={executeItemCommand}>
        <TreeItemChildren itemPath={rootPath} />
      </vscode-tree>
    </vscode-scrollable>
  )
}

const loadingAtom = atomRuntime.atom(
  Stream.unwrap(
    Effect.gen(function*() {
      const treeApp = yield* TreeApp
      return treeApp.loading
    })
  )
)

function TreeLoading() {
  const loading = useAtomSuspense(loadingAtom)
  return loading.value ? <vscode-progress-bar /> : null
}

export function App() {
  return (
    <>
      <ToolbarContainer />
      <TreeLoading />
      <TreeContainer />
    </>
  )
}
