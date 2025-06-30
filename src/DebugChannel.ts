import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import * as VsCode from "./VsCode"

export class VariableReference extends Data.TaggedClass("VariableReference")<{}> {}

interface DapVariableReference {
  readonly name: string
  readonly value: string
  readonly type?: string
  readonly variablesReference: number
}

interface DapEvaluateResponse {
  readonly result: string
  readonly type?: string
  readonly variablesReference: number
}

interface DapVariablesResponse {
  variables: Array<DapVariableReference>
}

export class DebugChannel extends Effect.Service<DebugChannel>()("DebugChannel", {
  effect: Effect.gen(function*() {
    const debugSession = yield* VsCode.VsCodeDebugSession
    const dapVariableReferences: WeakMap<VariableReference, DapVariableReference> = new WeakMap()

    return {
      evaluate: (expression: string) =>
        Effect.gen(function*() {
          const response = yield* VsCode.debugRequest<DapEvaluateResponse>("evaluate", { expression })
          const variableReference = new VariableReference()
          dapVariableReferences.set(variableReference, {
            name: "",
            value: response.result,
            type: response.type,
            variablesReference: response.variablesReference
          })
          return variableReference
        }),
      getValue: <A, I, R>(
        variableReference: VariableReference,
        schema: Schema.Schema<A, I, R>
      ): Effect.Effect<A, ParseResult.ParseError, R> =>
        Effect.gen(function*() {
          const dapVariableReference = dapVariableReferences.get(variableReference)
          if (!dapVariableReference) return yield* Effect.die("No DAP variable reference found")

          const extractFullValue = (
            dapVariableReference: DapVariableReference,
            ast: SchemaAST.AST
          ): Effect.Effect<any, never, never> =>
            Effect.gen(function*() {
              switch (ast._tag) {
                case "Literal":
                case "StringKeyword": {
                  const { value } = dapVariableReference
                  const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"")
                  const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
                  if (isDoubleQuoted || isSingleQuoted) {
                    return value.substring(1, value.length - 1)
                  }
                  return dapVariableReference.value
                }
                case "BooleanKeyword":
                  return dapVariableReference.value === "true"
                case "NumberKeyword":
                  return Number(dapVariableReference.value)
                case "TupleType": {
                  const { variables } = yield* VsCode.debugRequest<DapVariablesResponse>("variables", {
                    variablesReference: dapVariableReference.variablesReference
                  }).pipe(Effect.provideService(VsCode.VsCodeDebugSession, debugSession))
                  const lengthValue = variables.filter(
                    (variable) => String(Number(variable.name)) === variable.name
                  ).length

                  if (lengthValue === 0) return []

                  const elements = Array.makeBy(lengthValue, (index) => {
                    const indexProperty = variables.find((variable) => variable.name === String(index))
                    if (!indexProperty) return Effect.die(`Expected index ${index} to be present in the reference`)
                    const elementAst = index < ast.elements.length ? ast.elements[index] : ast.rest[0]
                    return extractFullValue(indexProperty, elementAst.type)
                  })
                  return yield* Effect.all(elements, { concurrency: "unbounded" })
                }

                case "TypeLiteral": {
                  const { variables } = yield* VsCode.debugRequest<DapVariablesResponse>("variables", {
                    variablesReference: dapVariableReference.variablesReference
                  }).pipe(Effect.provideService(VsCode.VsCodeDebugSession, debugSession))
                  const result: Record<string, unknown> = {}

                  for (const propertySignature of ast.propertySignatures) {
                    if (typeof propertySignature.name !== "string") {
                      return yield* Effect.die("Expected property name to be a string")
                    }
                    const propertyVariableReference = variables.find(
                      (variable) => variable.name === propertySignature.name
                    )
                    if (!propertyVariableReference) {
                      return yield* Effect.die(
                        `Expected property ${propertySignature.name} to be present in the reference`
                      )
                    }
                    result[propertySignature.name] = yield* extractFullValue(
                      propertyVariableReference,
                      propertySignature.type
                    )
                  }
                  return result
                }
                default:
                  return yield* Effect.die(`Unsupported schema type: ${ast._tag}`)
              }
            }).pipe(
              Effect.catchAllCause((cause) => {
                console.log(cause)
                return Effect.die("")
              })
            )

          const encodedValue = yield* extractFullValue(dapVariableReference, schema.ast)

          return yield* Schema.decode(schema)(encodedValue as any)
        })
    }
  })
}) {
}
