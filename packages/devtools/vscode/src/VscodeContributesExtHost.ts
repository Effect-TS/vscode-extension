import * as ExtCommand from "@effect/devtools-shared/core/ExtCommand"
import * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import type * as ExtIcon from "@effect/devtools-shared/core/ExtIcon"
import * as ExtTextEditor from "@effect/devtools-shared/core/ExtTextEditor"
import * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import * as ExtWhenClause from "@effect/devtools-shared/core/ExtWhenClause"
import type * as ExtWhenClauseAST from "@effect/devtools-shared/core/ExtWhenClauseAST"
import * as ExtWorkspace from "@effect/devtools-shared/core/ExtWorkspace"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Function from "effect/Function"
import * as JSONSchema from "effect/JSONSchema"
import * as Layer from "effect/Layer"
import * as SubscriptionRef from "effect/SubscriptionRef"

export interface ContributedCommand {
  command: string
  title: string
  icon?: string
  enablement?: string
}

function iconToVsCode(icon: ExtIcon.ExtIcon): string {
  return `$(${icon.name})`
}

function whenAstToVsCode(when: ExtWhenClauseAST.ExtWhenClauseAST): string {
  switch (when._tag) {
    case "BooleanLiteral":
      return when.value ? "true" : "false"
    case "StringLiteral":
      return when.value
    case "StringFromEnv":
    case "BooleanFromEnv":
      return when.name
    case "EqualsComparison":
      return `${whenAstToVsCode(when.left)} === ${whenAstToVsCode(when.right)}`
    case "AndExpression":
      return `${whenAstToVsCode(when.left)} && ${whenAstToVsCode(when.right)}`
    case "OrExpression":
      return `${whenAstToVsCode(when.left)} || ${whenAstToVsCode(when.right)}`
    case "ParenthesizedExpression":
      return `(${whenAstToVsCode(when.expression)})`
    default:
      return "unsuported " + (when as any)._tag
  }
}

// TODO: we can optimize out "true" literal conditions
function whenToVsCode<A extends ExtWhenClause.Any>(when: A): string {
  return whenAstToVsCode(when.ast)
}

export interface ContributedMenu {
  command: string
  when?: string
  group?: string
}

export interface ContributionObject {
  viewsWelcome: Array<ContributedViewsWelcome>
  viewsContainers: any
  commands: Array<ContributedCommand>
  configuration: ContributedConfiguration
  views: Record<string, Array<ContributedViewSection>>
  menus: { "view/title": Array<ContributedMenu>; "view/item/context": Array<ContributedMenu> }
}

export interface ContributedConfiguration {
  title: string
  properties: Record<string, ContributedConfigurationProperty>
}

export type ContributedConfigurationProperty = JSONSchema.JsonSchema7

export interface ContributedViewSection {
  type?: string
  id: string
  name: string
  when?: string
}

function treeViewProviderToVsCode(view: ExtTreeView.AnyWithProps): ContributedViewSection {
  const base: ContributedViewSection = {
    id: view._id,
    name: view.title
  }
  if (view.when) {
    base.when = whenToVsCode(view.when)
  }
  return base
}

function webViewProviderToVsCode(webView: ExtWebView.AnyWithProps): ContributedViewSection {
  const base: ContributedViewSection = {
    type: "webview",
    id: webView._id,
    name: webView.title
  }
  if (webView.when) {
    base.when = whenToVsCode(webView.when)
  }
  return base
}

export class CurrentContributes
  extends Context.Tag("effect-vscode/vscode/VscodeContributesExtHost/CurrentContributes")<CurrentContributes, {
    extensionTitle: string
    viewsContainers: any
    configuration: ContributedConfiguration
    commands: Array<ContributedCommand>
    viewsWelcome: Array<ContributedViewsWelcome>
    views: Record<string, ContributedViewSection>
    viewToContainer: Map<string, string>
    menus: {
      "view/title": Array<ContributedMenu>
      "view/item/context": Array<ContributedMenu>
      "commandPalette": Array<ContributedMenu>
    }
  }>()
{}

function configToVsCode(config: ExtConfig.AnyWithProps): ContributedConfigurationProperty {
  const schema = Either.try({
    try: () =>
      JSONSchema.fromAST(config.schema.ast, {
        topLevelReferenceStrategy: "skip",
        definitions: {}
      }),
    catch: () => new Error("Failed to convert config schema to JSON schema")
  }).pipe(Either.getOrElse(() => ({}))) as any as JSONSchema.JsonSchema7 // TODO: better default value
  delete (schema as any).$schema
  return schema
}

export const getContributes = Effect.gen(function*() {
  const current = yield* CurrentContributes
  const views: Record<string, Array<ContributedViewSection>> = {}
  for (const [id, section] of Object.entries(current.views)) {
    const sectionName = current.viewToContainer.get(id) || "effect"
    const previousSections = views[sectionName] || []
    views[sectionName] = [...previousSections, section]
  }
  return Function.identity<ContributionObject>({
    configuration: current.configuration,
    commands: current.commands,
    viewsContainers: current.viewsContainers,
    views,
    viewsWelcome: current.viewsWelcome,
    menus: current.menus
  })
})

interface ContributedViewsWelcome {
  view: string
  contents: string
}

export const initial = (opts: {
  extensionTitle: string
  viewsWelcome: Array<ContributedViewsWelcome>
  viewsContainers: any
}) =>
  Layer.succeed(CurrentContributes, {
    extensionTitle: opts.extensionTitle,
    viewsWelcome: opts.viewsWelcome,
    viewsContainers: opts.viewsContainers,
    commands: [],
    configuration: {
      title: opts.extensionTitle,
      properties: {}
    },
    views: {},
    viewToContainer: new Map(),
    menus: { "view/title": [], "view/item/context": [], "commandPalette": [] }
  })

const commandCapability = Layer.unwrapEffect(Effect.gen(function*() {
  const contributes = yield* CurrentContributes

  const registerCommand = (
    command: ExtCommand.AnyWithProps,
    _handler: ExtCommand.HandlerNoContext<string>
  ): Effect.Effect<void, never, never> => {
    const alreadyRegistered = contributes.commands.find((c) => c.command === command._id)
    if (alreadyRegistered) return Effect.void
    return Effect.sync(() => {
      const base: ContributedCommand = {
        command: command._id,
        title: !command.palette ? command.title : contributes.extensionTitle + ": " + command.title
      }
      if (command.icon) {
        base.icon = iconToVsCode(command.icon)
      }
      if (command.enablement) {
        base.enablement = whenToVsCode(command.enablement as any)
      }
      contributes.commands.push(base)
      contributes.menus["commandPalette"].push({
        command: command._id,
        when: command.palette ? (base.enablement || "true") : "false"
      })
    })
  }

  return Layer.succeed(ExtCommand.ExtCommandHostCapability, {
    registerCommand,
    executeCommand: () => Effect.void
  })
}))

const treeViewCapability = Layer.unwrapEffect(Effect.gen(function*() {
  const contributes = yield* CurrentContributes

  const registerTreeView = (
    _treeView: ExtTreeView.AnyWithProps,
    _builder: ExtTreeView.ExtTreeViewBuilder<any, never>
  ): Effect.Effect<void, never, never> => {
    const section = contributes.views[_treeView._id]
    if (section) return Effect.void
    return Effect.sync(() => {
      contributes.views[_treeView._id] = treeViewProviderToVsCode(_treeView)
    })
  }

  function registerTreeViewNavigationAction<
    V extends ExtTreeView.AnyWithProps,
    C extends ExtCommand.AnyWithProps
  >(
    _view: V,
    _command: C
  ) {
    return Effect.gen(function*() {
      let when = ExtWhenClause.equals(
        ExtWhenClause.stringFromEnv("view"),
        ExtWhenClause.stringLiteral(_view._id)
      )
      when = _command.enablement ? ExtWhenClause.and(when, _command.enablement) : when
      contributes.menus["view/title"].push({
        command: _command._id,
        when: whenToVsCode(when),
        group: "navigation"
      })
    })
  }

  function registerTreeViewTitleAction<
    V extends ExtTreeView.AnyWithProps,
    C extends ExtCommand.AnyWithProps
  >(
    _view: V,
    _command: C
  ) {
    return Effect.gen(function*() {
      let when = ExtWhenClause.equals(
        ExtWhenClause.stringFromEnv("view"),
        ExtWhenClause.stringLiteral(_view._id)
      )
      when = _command.enablement ? ExtWhenClause.and(when, _command.enablement) : when
      contributes.menus["view/title"].push({
        command: _command._id,
        when: whenToVsCode(when)
      })
    })
  }

  function registerTreeViewInlineAction<
    V extends ExtTreeView.AnyWithProps,
    C extends ExtCommand.AnyWithProps
  >(
    _view: V,
    _command: C
  ) {
    return <
      K extends Array<ExtTreeView.Keys<V, C>>
    >(
      ..._keys: K
    ) =>
      Effect.gen(function*() {
        const whenView = ExtWhenClause.equals(
          ExtWhenClause.stringFromEnv("view"),
          ExtWhenClause.stringLiteral(_view._id)
        )
        let when = _command.enablement
        when = when ? ExtWhenClause.and(whenView, when) : whenView
        if (_keys.length > 0) {
          let whenItemType: ExtWhenClause.AnyBoolean | undefined = undefined
          for (const key of _keys) {
            const whenItem = ExtWhenClause.equals(
              ExtWhenClause.stringFromEnv("viewItem"),
              ExtWhenClause.stringLiteral(String(key))
            )
            whenItemType = whenItemType ? ExtWhenClause.or(whenItemType, whenItem) : whenItem
          }
          if (whenItemType) when = ExtWhenClause.and(when, ExtWhenClause.parenthesized(whenItemType))
        }
        contributes.menus["view/item/context"].push({
          command: _command._id,
          when: whenToVsCode(when),
          group: "inline"
        })
      })
  }

  return Layer.succeed(ExtTreeView.ExtTreeViewHostCapability, {
    registerTreeView,
    registerTreeViewTitleAction,
    registerTreeViewNavigationAction,
    registerTreeViewInlineAction
  })
}))

const configCapability = Layer.unwrapEffect(Effect.gen(function*() {
  const contributes = yield* CurrentContributes
  const readConfig = (config: ExtConfig.AnyWithProps) => {
    return Effect.gen(function*() {
      const ref = yield* SubscriptionRef.make(config.defaultValue)
      return {
        get: SubscriptionRef.get(ref),
        changes: ref.changes
      }
    })
  }

  const registerConfig = (config: ExtConfig.AnyWithProps) => {
    const alreadyRegistered = contributes.configuration.properties[config._id]
    if (alreadyRegistered) return Effect.void
    return Effect.sync(() => {
      contributes.configuration.properties[config._id] = configToVsCode(config)
    })
  }

  return Layer.succeed(ExtConfig.ExtConfigHostCapability, {
    registerConfig,
    readConfig
  })
}))

const webViewCapability = Layer.unwrapEffect(Effect.gen(function*() {
  const contributes = yield* CurrentContributes

  const registerWebView = (
    _webView: ExtWebView.AnyWithProps,
    _builder: ExtWebView.ExtWebViewBuilder<never>
  ): Effect.Effect<void, never, never> => {
    const section = contributes.views[_webView._id]
    if (section) return Effect.void
    return Effect.sync(() => {
      contributes.views[_webView._id] = webViewProviderToVsCode(_webView)
    })
  }

  return Layer.succeed(ExtWebView.ExtWebViewHostCapability, {
    registerWebView
  })
}))

export const layer = Layer.empty.pipe(
  Layer.provideMerge(treeViewCapability),
  Layer.provideMerge(webViewCapability),
  Layer.provideMerge(commandCapability),
  Layer.provideMerge(configCapability),
  Layer.provideMerge(ExtWhenClause.layerInMemoryEvaluator),
  Layer.provideMerge(ExtWorkspace.layerAsIs),
  Layer.provideMerge(ExtTextEditor.layerNoop),
  Layer.provideMerge(ExtWhenClause.ExtWhenEvaluator.Default)
)

export function treeView<V extends ExtTreeView.Any>(
  treeView: V,
  section: string
): Layer.Layer<never, never, CurrentContributes | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>>> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
    contributes.viewToContainer.set(treeView._id, section)
  }))
}

export function webView<V extends ExtWebView.Any>(
  treeView: V,
  section: string
): Layer.Layer<never, never, CurrentContributes | ExtWebView.UnknownWebView<ExtWebView.Id<V>>> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
    contributes.viewToContainer.set(treeView._id, section)
  }))
}
