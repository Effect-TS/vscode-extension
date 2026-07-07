/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Effectable from "effect/Effectable"
import * as Layer from "effect/Layer"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Readable from "effect/Readable"
import * as Stream from "effect/Stream"
import * as Subscribable from "effect/Subscribable"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtWhenClauseAST from "./ExtWhenClauseAST.ts"
import { type ReadableSubscribable } from "./utils.ts"

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
  extends Effectable.Class<(value: Type) => Effect.Effect<void>, never, ExtWhenClauseHostCapability>
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
      const devtoolsHost = yield* ExtWhenClauseHostCapability
      return (value: Type) => devtoolsHost.setVariable(this._id, value)
    })
  }

  layerDefault(value: Type): Layer.Layer<MissingVar<Id, Type>, never, ExtWhenClauseHostCapability> {
    return Layer.effectDiscard(Effect.gen(this, function*() {
      const devtoolsHost = yield* ExtWhenClauseHostCapability
      yield* devtoolsHost.setVariable(this._id, value)
    })) as any
  }
}

export class ExtWhenClauseHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtWhenClause/ExtWhenClauseHostCapability")<
    ExtWhenClauseHostCapability,
    {
      setVariable<Type>(id: string, value: Type): Effect.Effect<void, never, never>
    }
  >()
{}

export class ExtWhenEvaluator
  extends Effect.Service<ExtWhenEvaluator>()("@effect/devtools-shared/core/ExtWhenEvaluator", {
    effect: Effect.gen(function*() {
      const vars = yield* SubscriptionRef.make<Record<string, any>>({})

      function evaluateAstNow<X extends ExtWhenClauseAST.ExtWhenClauseAST>(
        ast: X,
        env: Record<string, any>
      ): Effect.Effect<any, never, never> {
        switch (ast._tag) {
          case "StringLiteral":
            return Effect.succeed(ast.value)
          case "BooleanLiteral":
            return Effect.succeed(ast.value)
          case "StringFromEnv":
            return Effect.succeed(env[ast.name])
          case "BooleanFromEnv":
            return Effect.succeed(env[ast.name])
          case "EqualsComparison":
            return Effect.zipWith(
              evaluateAstNow(ast.left, env),
              evaluateAstNow(ast.right, env),
              (left, right) => left === right
            )
          case "AndExpression":
            return Effect.zipWith(
              evaluateAstNow(ast.left, env),
              evaluateAstNow(ast.right, env),
              (left, right) => left && right
            )
          case "OrExpression":
            return Effect.zipWith(
              evaluateAstNow(ast.left, env),
              evaluateAstNow(ast.right, env),
              (left, right) => left || right
            )
          case "ParenthesizedExpression":
            return evaluateAstNow(ast.expression, env)
          default:
            return Effect.die(new Error(`Unsupported AST node: ${(ast as any)._tag}`))
        }
      }

      function evaluate<X extends Any>(
        clause: X
      ): Effect.Effect<ReadableSubscribable<Type<X>>, never, Context<X>> {
        return Effect.gen(function*() {
          const get = SubscriptionRef.get(vars).pipe(Effect.flatMap((env) => evaluateAstNow(clause.ast, env)))
          return ({
            [Subscribable.TypeId]: Subscribable.TypeId,
            [Readable.TypeId]: Readable.TypeId,
            get,
            changes: vars.changes.pipe(Stream.mapEffect(() => get), Stream.changes),
            pipe() {
              return pipeArguments(this, arguments)
            }
          })
        })
      }

      function setVar(name: string, value: any) {
        return SubscriptionRef.update(vars, (vars) => ({ ...vars, [name]: value }))
      }

      return { evaluate, setVar }
    })
  })
{}

export const layerInMemoryEvaluator = Layer.unwrapEffect(Effect.gen(function*() {
  const evaluator = yield* ExtWhenEvaluator
  return Layer.succeed(ExtWhenClauseHostCapability, {
    setVariable: (id, value) => evaluator.setVar(id, value)
  })
}))
