import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import { InMessage, OutMessage } from "./index.ts"

class GoContext extends Context.Tag("GoContext")<GoContext, {
  mod: string
  statements: Array<string>
  hoistedNames: Map<SchemaAST.AST, string>
}>() {}

function goWorker(ast: SchemaAST.AST): Effect.Effect<string, never, GoContext> {
  return Effect.gen(function*() {
    const { mod } = yield* GoContext
    switch (ast._tag) {
      case "BigIntKeyword":
        return `${mod}.bigint`
      case "BooleanKeyword":
        return `${mod}.boolean`
      case "UndefinedKeyword":
        return `${mod}.undefined`
      case "NumberKeyword":
        return `${mod}.number`
      case "StringKeyword":
        return `${mod}.string`
      case "Literal":
        return `${mod}.literal(${JSON.stringify(ast.literal)})`
      case "TupleType": {
        const results = yield* Effect.all(ast.rest.map((_) => go(_.type)))
        return `${mod}.array(${results.join(", ")})`
      }
      case "Union": {
        const results = yield* Effect.all(ast.types.map(go))
        return `${mod}.union(${results.join(", ")})`
      }
      case "TypeLiteral": {
        const ps = ast.propertySignatures
        const results = yield* Effect.all(ps.map((_) => go(_.type)))
        return `${mod}.struct({${results.map((_, i) => `${String(ps[i].name)}: ${_}`).join(", ")}})`
      }
    }

    return yield* Effect.die(new Error(`Unsupported AST node: ${ast._tag}`))
  })
}

function hostStatement(
  worker: string,
  identifier: string,
  ast: SchemaAST.AST
): Effect.Effect<string, never, GoContext> {
  return Effect.gen(function*() {
    const { hoistedNames, mod, statements } = yield* GoContext
    statements.push(`export const ${identifier} = ${worker}`)
    statements.push(`export type ${identifier} = ${mod}.Type<typeof ${identifier}>`)
    hoistedNames.set(ast, identifier)
    return `${String(identifier)}`
  })
}

function go(ast: SchemaAST.AST): Effect.Effect<string, never, GoContext> {
  return Effect.gen(function*() {
    const { hoistedNames } = yield* GoContext
    const hoistedName = hoistedNames.get(ast)
    if (hoistedName) return hoistedName
    const worker = yield* goWorker(ast)
    const identifier = SchemaAST.getIdentifierAnnotation(ast)
    if (Option.isSome(identifier)) return yield* hostStatement(worker, identifier.value, ast)
    return worker
  })
}

function compiler<X extends Schema.Schema.AnyNoContext>(schema: X): Effect.Effect<string, never, GoContext> {
  return go(schema.ast)
}

export const schemalessProtocolEncoder = Effect.gen(function*() {
  yield* compiler(OutMessage)
  const { statements } = yield* GoContext
  return [
    `/* eslint-disable @effect/dprint */`,
    `import * as Encoder from "./Encoder.ts"`,
    ``,
    ...statements,
    ``
  ].join("\n")
}).pipe(
  Effect.provideService(GoContext, GoContext.of({ mod: "Encoder", statements: [], hoistedNames: new Map() }))
)

export const schemalessProtocolDecoder = Effect.gen(function*() {
  yield* compiler(InMessage)
  const { statements } = yield* GoContext
  return [
    `/* eslint-disable @effect/dprint */`,
    `import * as Decoder from "./Decoder.ts"`,
    ``,
    ...statements,
    ``
  ].join("\n")
}).pipe(
  Effect.provideService(GoContext, GoContext.of({ mod: "Decoder", statements: [], hoistedNames: new Map() }))
)
