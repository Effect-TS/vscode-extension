import * as Effect from "effect/Effect"
import { pipeArguments } from "effect/Pipeable"
import * as Readable from "effect/Readable"
import * as Stream from "effect/Stream"
import * as Subscribable from "effect/Subscribable"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as ExtWhenClause from "./ExtWhenClause.ts"
import type * as ExtWhenClauseAST from "./ExtWhenClauseAST.ts"
import type { ReadableSubscribable } from "./utils.ts"

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

      function evaluate<X extends ExtWhenClause.Any>(
        clause: X
      ): Effect.Effect<ReadableSubscribable<ExtWhenClause.Type<X>>, never, ExtWhenClause.Context<X>> {
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
