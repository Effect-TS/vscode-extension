/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type { ExtIcon } from "./ExtIcon.ts"
import * as ExtWhenClause from "./ExtWhenClause.ts"

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtCommand")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtCommand = (
  u: unknown
): u is ExtCommand<any, any, any, any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool command that can be executed in a devtool application.
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtCommand<
  in out Id extends string,
  out Payload extends Schema.Schema.AnyNoContext = typeof Schema.Void,
  out Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
  out Error extends Schema.Schema.All = typeof Schema.Never,
  in out R = never
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _id: Id
  readonly title: string
  readonly icon: ExtIcon | undefined
  readonly palette: boolean
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
  readonly enablement: ExtWhenClause.ExtWhenClause<boolean, R>

  execute(
    ...args: PayloadConstructor<this> extends void ? []
      : [PayloadConstructor<this>]
  ): Effect.Effect<
    Schema.Schema.Type<Success>,
    Schema.Schema.Type<Error>,
    UnknownCommand<Id> | ExtCommandHostCapability
  >

  withArgs(
    ...args: PayloadConstructor<this> extends void ? []
      : [PayloadConstructor<this>]
  ): Effect.Effect<CommandWithArgs<this>>

  /**
   * Converts a toolkit into a Layer containing handlers for each tool in the
   * toolkit.
   */
  toLayer<EX = never, RX = never>(
    build: Effect.Effect<
      (
        args: Schema.Schema.Type<Payload>
      ) => Effect.Effect<
        Schema.Schema.Type<Success>,
        Schema.Schema.Type<Error>
      >,
      EX,
      RX
    >
  ): Layer.Layer<
    UnknownCommand<Id>,
    EX,
    Exclude<RX, Scope.Scope> | ExtCommandHostCapability
  >
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Any extends Pipeable {
  readonly [TypeId]: TypeId
  readonly _id: string
}

/**
 * @since 1.0.0
 * @category models
 */
export interface AnyWithProps {
  readonly [TypeId]: TypeId
  readonly _id: string
  readonly title: string
  readonly icon: ExtIcon | undefined
  readonly palette: boolean
  readonly payloadSchema: Schema.Schema.AnyNoContext
  readonly successSchema: Schema.Schema.AnyNoContext
  readonly errorSchema: Schema.Schema.All
  readonly enablement: ExtWhenClause.AnyBoolean
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Id
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Success<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Success["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type SuccessEncoded<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Success["Encoded"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type ErrorSchema<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Error
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Error<R> = Schema.Schema.Type<ErrorSchema<R>>

/**
 * @since 1.0.0
 * @category models
 */
export type ErrorEncoded<R> = Schema.Schema.Encoded<ErrorSchema<R>>

/**
 * @since 1.0.0
 * @category models
 */
export type PayloadConstructor<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
>
  ? _Payload extends { readonly fields: Schema.Struct.Fields }
    ? Schema.Simplify<Schema.Struct.Constructor<_Payload["fields"]>>
  : _Payload["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Payload<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Payload["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type PayloadEncoded<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Payload["Encoded"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? _Payload["Context"] | _Success["Context"] | _Error["Context"] | _R
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Handler<_Id extends string> = (
  payload: any
) => Effect.Effect<any, any, any>

/**
 * @since 1.0.0
 * @category models
 */
export type HandlerNoContext<_Id extends string> = (
  payload: any
) => Effect.Effect<any, any, never>

/**
 * @since 1.0.0
 * @category models
 */
export type ToHandler<R extends Any> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? Handler<_Id>
  : never

export interface UnknownCommand<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
}

export interface CommandWithArgs<R extends AnyWithProps> {
  readonly command: R
  readonly arguments: [PayloadEncoded<R>]
}

/**
 * @since 1.0.0
 * @category models
 */
export type ToHandlerFn<Current extends Any, R = any> = (
  payload: Payload<Current>
) => ResultFrom<Current, R>

/**
 * @since 1.0.0
 * @category models
 */
export type ResultFrom<R extends Any, Context> = R extends ExtCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error,
  infer _R
> ? Effect.Effect<_Success["Type"], _Error["Type"], Context>
  : never

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  toLayer(this: AnyWithProps, build: Effect.Effect<Handler<string>>) {
    return Layer.effectDiscard(
      Effect.gen(this, function*() {
        const host = yield* ExtCommandHostCapability
        const context = yield* Effect.context<any>()
        const handler = yield* build
        yield* host.registerCommand(this, (arg) => handler(arg).pipe(Effect.provide(context)))
      })
    )
  },
  execute(this: AnyWithProps, arg: any) {
    return Effect.gen(this, function*() {
      const host = yield* ExtCommandHostCapability
      yield* host.executeCommand(this, arg)
    })
  },
  withArgs(this: AnyWithProps, arg: any) {
    return Effect.gen(this, function*() {
      return {
        command: this,
        arguments: [arg]
      }
    })
  }
}

const makeProto = <
  const Id extends string,
  Payload extends Schema.Schema.AnyNoContext,
  Success extends Schema.Schema.AnyNoContext,
  Error extends Schema.Schema.All,
  Enablement extends ExtWhenClause.Any
>(options: {
  readonly _id: Id
  readonly title: string
  readonly icon: ExtIcon | undefined
  readonly palette: boolean
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
  readonly enablement: Enablement
}): ExtCommand<Id, Payload, Success, Error, Enablement> => {
  function ExtCommand() {}
  Object.setPrototypeOf(ExtCommand, Proto)
  Object.assign(ExtCommand, options)
  return ExtCommand as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <
  const Id extends string,
  Payload extends Schema.Schema.AnyNoContext = typeof Schema.Void,
  Success extends Schema.Schema.AnyNoContext = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never,
  Enablement extends ExtWhenClause.Any = never
>(
  id: Id,
  options?: {
    readonly title?: string
    readonly icon?: ExtIcon
    readonly palette?: boolean
    readonly payload?: Payload
    readonly success?: Success
    readonly error?: Error
    readonly enablement?: Enablement
  }
): ExtCommand<
  Id,
  Payload,
  Success,
  Error,
  ExtWhenClause.Context<Enablement>
> => {
  const successSchema = options?.success ?? Schema.Void
  const errorSchema = options?.error ?? Schema.Never
  const enablement = options?.enablement ?? ExtWhenClause.trueLiteral
  const payloadSchema: any = Schema.isSchema(options?.payload)
    ? (options?.payload as any)
    : options?.payload
    ? Schema.Struct(options?.payload as any)
    : Schema.Void
  const palette = options?.palette ?? false

  return makeProto({
    _id: id,
    title: options?.title ?? id,
    icon: options?.icon,
    palette,
    payloadSchema,
    successSchema,
    errorSchema,
    enablement
  }) as any
}

export class ExtCommandHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtCommand/ExtCommandHostCapability")<
    ExtCommandHostCapability,
    {
      registerCommand(
        command: AnyWithProps,
        handler: HandlerNoContext<string>
      ): Effect.Effect<void, never, never>
      executeCommand(
        command: AnyWithProps,
        payloadEncoded: any
      ): Effect.Effect<any, any, never>
    }
  >()
{}

export const layerInMemory = Layer.unwrapEffect(Effect.gen(function*() {
  const commandHandlers = new Map<string, HandlerNoContext<string>>()

  return Layer.succeed(ExtCommandHostCapability, {
    registerCommand: (command, handler) => Effect.sync(() => commandHandlers.set(command._id, handler)),
    executeCommand: (command, payloadEncoded) =>
      Effect.suspend(() => {
        const handler = commandHandlers.get(command._id)
        if (!handler) return Effect.die(`Command ${command._id} not found`)
        return handler(payloadEncoded)
      })
  })
}))
