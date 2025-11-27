/**
 * @since 1.0.0
 */
import * as Effect from "effect/Effect"
import * as Effectable from "effect/Effectable"
import * as Layer from "effect/Layer"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as ExtHost from "./ExtHost.ts"
import * as ExtWhenClauseAST from "./ExtWhenClauseAST.ts"

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtWhenClause")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtWhenClause = (u: unknown): u is ExtWhenClause<any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool view context value.
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtWhenClause<
  out Type = unknown,
  in out RIn = never
> extends Pipeable {
  readonly type: Type
  readonly rIn: RIn

  readonly [TypeId]: TypeId
  readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Any extends Pipeable {
  readonly [TypeId]: TypeId
  readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
}

export interface AnyBoolean extends Pipeable {
  readonly [TypeId]: TypeId
  readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
  readonly type: boolean
}

/**
 * @since 1.0.0
 * @category models
 */
export type Type<R> = R extends Any & { readonly type: infer _Type } ? _Type : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends ExtWhenClause<infer _Type, infer _RIn> ? _RIn : never

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  }
}

const makeProto = <Type, RIn>(options: {
  readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
}): ExtWhenClause<Type, RIn> => {
  function ExtWhenClause() {}
  Object.setPrototypeOf(ExtWhenClause, Proto)
  Object.assign(ExtWhenClause, options)
  return ExtWhenClause as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <
  Type = never,
  RIn = never
>(
  options: {
    readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
  }
): ExtWhenClause<Type, RIn> => {
  return makeProto<Type, RIn>({
    ast: options.ast
  }) as any
}

export interface MissingVar<Id extends string, Type> {
  readonly _id: Id
  readonly _type: Type
  readonly _kind: unique symbol
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const booleanFromEnv = <const Name extends string>(
  name: Name
) => {
  return new ExtWhenClauseInput<Name, boolean>(name, ExtWhenClauseAST.booleanFromEnv(name))
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const stringFromEnv = <const Name extends string>(name: Name) => {
  return new ExtWhenClauseInput<Name, string>(name, ExtWhenClauseAST.stringFromEnv(name))
}

export const falseLiteral = make<false, never>({
  ast: ExtWhenClauseAST.booleanLiteral(false)
})

export const trueLiteral = make<true, never>({
  ast: ExtWhenClauseAST.booleanLiteral(true)
})

export const stringLiteral = <const Value extends string>(value: Value): ExtWhenClause<string, never> => {
  return make({
    ast: ExtWhenClauseAST.stringLiteral(value)
  }) as any
}

export const and = <A extends AnyBoolean, B extends AnyBoolean>(
  left: A,
  right: B
): ExtWhenClause<boolean, Context<A> | Context<B>> => {
  return make({
    ast: ExtWhenClauseAST.andExpression(left.ast, right.ast)
  }) as any
}

export const or = <A extends AnyBoolean, B extends AnyBoolean>(
  left: A,
  right: B
): ExtWhenClause<boolean, Context<A> | Context<B>> => {
  return make({
    ast: ExtWhenClauseAST.orExpression(left.ast, right.ast)
  }) as any
}

export const parenthesized = <C extends Any>(
  expression: C
): C => {
  return make({
    ast: ExtWhenClauseAST.parenthesizedExpression(expression.ast)
  }) as any
}
export const equals = <Value, RIn1, RIn2>(
  left: ExtWhenClause<Value, RIn1>,
  right: ExtWhenClause<Value, RIn2>
): ExtWhenClause<boolean, RIn1 | RIn2> => {
  return make({
    ast: ExtWhenClauseAST.equalsComparison(left.ast, right.ast)
  }) as any
}

export class ExtWhenClauseInput<const Id extends string, Type>
  extends Effectable.Class<(value: Type) => Effect.Effect<void>, never, ExtHost.ExtHost>
  implements ExtWhenClause<Type, MissingVar<Id, Type>>
{
  readonly type!: Type
  readonly rIn!: MissingVar<Id, Type>

  readonly [TypeId]: TypeId = TypeId
  readonly _id: Id
  readonly ast: ExtWhenClauseAST.ExtWhenClauseAST
  constructor(_id: Id, ast: ExtWhenClauseAST.ExtWhenClauseAST) {
    super()
    this._id = _id
    this.ast = ast
  }

  commit() {
    return Effect.gen(this, function*() {
      const devtoolsHost = yield* ExtHost.ExtHost
      return (value: Type) => devtoolsHost.setVariable(this._id, value)
    })
  }

  layerDefault(value: Type): Layer.Layer<MissingVar<Id, Type>, never, ExtHost.ExtHost> {
    return Layer.effectDiscard(Effect.gen(this, function*() {
      const devtoolsHost = yield* ExtHost.ExtHost
      yield* devtoolsHost.setVariable(this._id, value)
    })) as any
  }
}
