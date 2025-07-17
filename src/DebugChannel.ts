import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as VsCode from "./VsCode"

export class DebugChannelError extends Data.TaggedError("VariableExtractError")<{
  readonly message: string
}> {}

export class VariableReference extends Data.TaggedClass("VariableReference")<{
  readonly name?: string
  readonly value?: string
  readonly isContainer: boolean
  readonly children: Effect.Effect<Array<VariableReference>, DebugChannelError, never>
  readonly parse: <A, I, R>(
    schema: Schema.Schema<A, I, R>
  ) => Effect.Effect<A, DebugChannelError | ParseResult.ParseError, R>
}> {
  static SchemaFromSelf = Schema.declare((_) => _ instanceof VariableReference, { identifier: "VariableReference" })
}

export class DebugChannel extends Effect.Tag("effect-vscode/DebugChannel")<DebugChannel, {
  evaluate: (
    expression: string
  ) => Effect.Effect<VariableReference, DebugChannelError, never>
}>() {}

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

export const makeVsCodeDebugSession = (debugSession: VsCode.VsCodeDebugSession["Type"]) =>
  Effect.gen(function*() {
    const debugRequest = <A = never>(command: string, args?: any) =>
      VsCode.thenableCatch<A, DebugChannelError>(() => debugSession.customRequest(command, args), (error) =>
        new DebugChannelError({ message: String(error) }))

    const extractValue = (
      dapVariableReference: DapVariableReference,
      ast: SchemaAST.AST
    ): Effect.Effect<any, DebugChannelError | ParseResult.ParseError, never> =>
      Effect.gen(function*() {
        switch (ast._tag) {
          case "Declaration": {
            const identifier = SchemaAST.getIdentifierAnnotation(ast)
            if (Option.isSome(identifier) && identifier.value === "VariableReference") {
              return makeVariableReference(dapVariableReference)
            }
            return yield* new DebugChannelError({
              message: `Unsupported schema declaration type: ${ast._tag}`
            })
          }
          case "Union": {
            return yield* Effect.firstSuccessOf(
              ast.types.map((typeAST) =>
                extractValue(dapVariableReference, typeAST)
              )
            )
          }
          case "Transformation":
            return yield* extractValue(dapVariableReference, ast.from)
          case "Refinement":
            return yield* extractValue(dapVariableReference, ast.from)
          case "Literal":
          case "StringKeyword": {
            const { value } = dapVariableReference
            const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"")
            const isSingleQuoted = value.startsWith("'") && value.endsWith("'")
            const stringValue = isDoubleQuoted || isSingleQuoted ? value.substring(1, value.length - 1) : value

            if (ast._tag === "Literal") {
              if (ast.literal !== stringValue) {
                return yield* new DebugChannelError({
                  message: `Expected ${ast.literal} got ${stringValue}`
                })
              }
            }
            return stringValue
          }
          case "BooleanKeyword":
            return dapVariableReference.value === "true"
          case "NumberKeyword":
            return yield* Schema.decode(Schema.NumberFromString)(dapVariableReference.value)
          case "TupleType": {
            const { variables } = yield* debugRequest<DapVariablesResponse>("variables", {
              variablesReference: dapVariableReference.variablesReference
            })
            const lengthValue = variables.filter(
              (variable) => String(Number(variable.name)) === variable.name
            ).length

            if (lengthValue === 0) return []

            const elements = Array.makeBy(lengthValue, (index) => {
              const indexProperty = variables.find((variable) => variable.name === String(index))
              if (!indexProperty) {
                return new DebugChannelError({
                  message: `Expected index ${index} to be present in the reference`
                })
              }
              const elementAst = index < ast.elements.length ? ast.elements[index] : ast.rest[0]
              return extractValue(indexProperty, elementAst.type)
            })
            return yield* Effect.all(elements, { concurrency: "unbounded" })
          }

          case "TypeLiteral": {
            const { variables } = yield* debugRequest<DapVariablesResponse>("variables", {
              variablesReference: dapVariableReference.variablesReference
            })
            const result: Record<
              string,
              Effect.Effect<any, DebugChannelError | ParseResult.ParseError, never>
            > = {}

            for (const propertySignature of ast.propertySignatures) {
              if (typeof propertySignature.name !== "string") {
                return yield* new DebugChannelError({
                  message: "Expected property name to be a string"
                })
              }
              const propertyVariableReference = variables.find(
                (variable) => variable.name === propertySignature.name
              )
              if (!propertyVariableReference) {
                return yield* new DebugChannelError({
                  message: `Expected property ${propertySignature.name} to be present in the reference`
                })
              }
              result[propertySignature.name] = extractValue(
                propertyVariableReference,
                propertySignature.type
              )
            }
            return yield* Effect.all(result, { concurrency: "unbounded" })
          }
          case "Suspend": {
            return yield* extractValue(dapVariableReference, ast.f())
          }
          default:
            return yield* new DebugChannelError({
              message: `Unsupported schema type: ${ast._tag}`
            })
        }
      })

    function makeVariableReference(dapVariableReference: DapVariableReference): VariableReference {
      return new VariableReference({
        children: debugRequest<DapVariablesResponse>("variables", {
          variablesReference: dapVariableReference.variablesReference
        }).pipe(
          Effect.map((_) => _.variables),
          Effect.map(Array.map(makeVariableReference))
        ),
        parse: (schema) =>
          Effect.gen(function*() {
            const input = yield* extractValue(dapVariableReference, schema.ast)
            return yield* Schema.decode(schema)(input)
          }),
        name: dapVariableReference.name,
        value: dapVariableReference.value,
        isContainer: dapVariableReference.variablesReference !== 0
      })
    }

    return DebugChannel.of({
      evaluate: (expression: string) =>
        Effect.gen(function*() {
          const response = yield* debugRequest<DapEvaluateResponse>("evaluate", { expression })
          return makeVariableReference({
            name: "",
            value: response.result,
            type: response.type,
            variablesReference: response.variablesReference
          })
        })
    })
  })
