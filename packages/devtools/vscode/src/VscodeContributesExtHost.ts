import type * as ExtCommand from "@effect/devtools-shared/core/ExtCommand"
import type * as ExtConfig from "@effect/devtools-shared/core/ExtConfig"
import * as ExtHost from "@effect/devtools-shared/core/ExtHost"
import type * as ExtIcon from "@effect/devtools-shared/core/ExtIcon"
import type * as ExtTreeView from "@effect/devtools-shared/core/ExtTreeView"
import type * as ExtWebView from "@effect/devtools-shared/core/ExtWebView"
import * as ExtWhenClause from "@effect/devtools-shared/core/ExtWhenClause"
import type * as ExtWhenClauseAST from "@effect/devtools-shared/core/ExtWhenClauseAST"
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
    menus: { "view/title": Array<ContributedMenu>; "view/item/context": Array<ContributedMenu> }
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
    menus: { "view/title": [], "view/item/context": [] }
  })

export const VscodeContributesExtHost = Layer.scoped(
  ExtHost.ExtHost,
  Effect.gen(function*() {
    const contributes = yield* CurrentContributes

    const asWorkspaceRelativePath = (uri: string): string => {
      return uri
    }

    const revealFileLineColumnRange = (
      _path: string,
      _line: number,
      _column: number,
      _endLine: number,
      _endColumn: number
    ) => Effect.void

    const registerCommand = (
      command: ExtCommand.AnyWithProps,
      _handler: ExtCommand.HandlerNoContext<string>
    ): Effect.Effect<void, never, never> => {
      const alreadyRegistered = contributes.commands.find((c) => c.command === command._id)
      if (alreadyRegistered) return Effect.void
      return Effect.sync(() => {
        const base: ContributedCommand = {
          command: command._id,
          title: contributes.extensionTitle + ": " + command.title
        }
        if (command.icon) {
          base.icon = iconToVsCode(command.icon)
        }
        if (command.enablement) {
          base.enablement = whenToVsCode(command.enablement as any)
        }
        contributes.commands.push(base)
      })
    }

    const executeCommand = (
      _command: ExtCommand.AnyWithProps,
      _arg: any
    ): Effect.Effect<any, any, never> => {
      return Effect.void
    }

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

    const setVariable = (_id: string, _value: any) => {
      return Effect.void
    }

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

    return {
      asWorkspaceRelativePath,
      registerCommand,
      executeCommand,
      revealFileLineColumnRange,
      registerTreeView,
      registerWebView,
      setVariable,
      registerConfig,
      readConfig
    }
  })
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

type Keys<V extends ExtTreeView.AnyWithProps, C extends ExtCommand.AnyWithProps> = ExtTreeView.Item<V> extends
  { _tag: infer K } ?
  (K extends infer X ? (Extract<ExtTreeView.Item<V>, { _tag: X }> extends ExtCommand.PayloadEncoded<C> ? X
      : never) :
    never)
  : never

export function treeViewInlineAction<
  V extends ExtTreeView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
) {
  return <
    K extends Array<Keys<V, C>>
  >(
    ..._keys: K
  ): Layer.Layer<
    never,
    never,
    CurrentContributes | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
  > =>
    Layer.effectDiscard(Effect.gen(function*() {
      const contributes = yield* CurrentContributes
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
    }))
}

export function treeViewNavigationAction<
  V extends ExtTreeView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
): Layer.Layer<
  never,
  never,
  CurrentContributes | ExtTreeView.UnknownTreeView<ExtTreeView.Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
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
  }))
}

export function webViewNavigationAction<
  V extends ExtWebView.AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  _view: V,
  _command: C
): Layer.Layer<
  never,
  never,
  CurrentContributes | ExtWebView.UnknownWebView<ExtWebView.Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.effectDiscard(Effect.gen(function*() {
    const contributes = yield* CurrentContributes
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
  }))
}
