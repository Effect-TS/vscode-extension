import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Schema from "effect/Schema"

export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")("Initialized", {}) {}

export class ItemPath extends Schema.Class<ItemPath>("ItemPath")({
  path: Schema.Array(Schema.NonEmptyString)
}) {
  [Equal.symbol](other: ItemPath): boolean {
    return this.path.length === other.path.length && this.path.every((item, index) => item === other.path[index])
  }
  [Hash.symbol](): number {
    return Hash.hash(Hash.array(this.path))
  }
}

export class InvalidatedIds extends Schema.TaggedClass<InvalidatedIds>("InvalidatedIds")("InvalidatedIds", {
  itemIds: Schema.Option(Schema.Array(Schema.NonEmptyString))
}) {}

export class RequestTreeItemInfo
  extends Schema.TaggedClass<RequestTreeItemInfo>("RequestTreeItemInfo")("RequestTreeItemInfo", {
    itemPath: ItemPath
  })
{}

export class TreeItemInfo extends Schema.TaggedClass<TreeItemInfo>("TreeItemInfo")("TreeItemInfo", {
  itemPath: ItemPath,
  icon: Schema.Option(Schema.String),
  label: Schema.NonEmptyString,
  description: Schema.String,
  collapsibleState: Schema.Union(Schema.Literal("none"), Schema.Literal("collapsed"), Schema.Literal("expanded")),
  hasCommand: Schema.Boolean,
  inlineActions: Schema.Array(Schema.Struct({
    commandId: Schema.NonEmptyString,
    title: Schema.String,
    icon: Schema.String
  }))
}) {}

export class RequestTreeItemChildren
  extends Schema.TaggedClass<RequestTreeItemChildren>("RequestTreeItemChildren")("RequestTreeItemChildren", {
    itemPath: ItemPath
  })
{}

export class TreeItemChildrenInfo
  extends Schema.TaggedClass<TreeItemChildrenInfo>("TreeItemChildrenInfo")("TreeItemChildrenInfo", {
    itemPath: ItemPath,
    children: Schema.Array(Schema.NonEmptyString)
  })
{}

export class RequestTitleActions
  extends Schema.TaggedClass<RequestTitleActions>("RequestTitleActions")("RequestTitleActions", {})
{}

export class TitleAction extends Schema.TaggedClass<TitleAction>("TitleAction")("TitleAction", {
  id: Schema.NonEmptyString,
  enabled: Schema.Boolean,
  icon: Schema.Option(Schema.String),
  label: Schema.String,
  group: Schema.Literal("navigation", "")
}) {}

export class TitleActionsInfo extends Schema.TaggedClass<TitleActionsInfo>("TitleActionsInfo")("TitleActionsInfo", {
  actions: Schema.Array(TitleAction)
}) {}

export class ExecuteTitleAction
  extends Schema.TaggedClass<ExecuteTitleAction>("ExecuteTitleAction")("ExecuteTitleAction", {
    id: Schema.NonEmptyString
  })
{}

export class ExecuteItemCommand
  extends Schema.TaggedClass<ExecuteItemCommand>("ExecuteItemCommand")("ExecuteItemCommand", {
    itemPath: ItemPath
  })
{}

export class ExecuteItemAction extends Schema.TaggedClass<ExecuteItemAction>("ExecuteItemAction")("ExecuteItemAction", {
  itemPath: ItemPath,
  commandId: Schema.NonEmptyString
}) {}

export class LoadingInfo extends Schema.TaggedClass<LoadingInfo>("LoadingInfo")("LoadingInfo", {
  isLoading: Schema.Boolean
}) {}

export const InMessage = Schema.Union(InvalidatedIds, TreeItemInfo, TreeItemChildrenInfo, TitleActionsInfo, LoadingInfo)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(
  RequestTreeItemInfo,
  RequestTreeItemChildren,
  RequestTitleActions,
  ExecuteTitleAction,
  ExecuteItemCommand,
  ExecuteItemAction,
  Initialized
)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
