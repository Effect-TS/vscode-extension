import * as ChannelSchema from "@effect/platform/ChannelSchema"
import * as Socket from "@effect/platform/Socket"
import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Function from "effect/Function"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import type * as ParseResult from "effect/ParseResult"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as Stream from "effect/Stream"
import * as ws from "ws"
import * as VsCode from "./VsCode"

export class DebugChannelError extends Data.TaggedError("DebugChannelError")<{
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
    opts: {
      expression: string
      guessFrameId: boolean
      threadId: number | undefined
    }
  ) => Effect.Effect<VariableReference, DebugChannelError, never>
  evaluateOnEveryExecutionContext: (
    opts: {
      expression: string
    }
  ) => Effect.Effect<void, DebugChannelError, never>
}>() {}

export interface CdpProxyClient {
  readonly queue: Mailbox.ReadonlyMailbox<unknown>
  readonly request: (_: unknown) => Effect.Effect<void>
}

export const run = Effect.fnUntraced(
  function*<R, E, _>(socket: Socket.Socket, handle: (client: CdpProxyClient) => Effect.Effect<_, E, R>) {
    const responses = yield* Mailbox.make<unknown>()
    const requests = yield* Mailbox.make<unknown>()

    const client: CdpProxyClient = {
      queue: requests,
      request: (res) => responses.offer(res)
    }

    yield* Mailbox.toStream(responses).pipe(
      Stream.pipeThroughChannel(
        ChannelSchema.duplexUnknown(Socket.toChannelString(socket), {
          inputSchema: Schema.parseJson(Schema.Unknown),
          outputSchema: Schema.parseJson(Schema.Unknown)
        })
      ),
      Stream.runForEach((req) => requests.offer(req)),
      Effect.ensuring(Effect.zipRight(responses.shutdown, requests.shutdown)),
      Effect.forkScoped
    )

    yield* handle(client)
  }
)

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

interface DapThreadsResponse {
  threads: Array<DapThread>
}

interface DapThread {
  id: number
  name: string
}

interface DapStackTracesResponse {
  stackFrames: Array<DapStackFrame>
}

interface DapStackFrame {
  id: number
  name: string
}

interface DapVariablesResponse {
  variables: Array<DapVariableReference>
}

export const makeVsCodeDebugSession = (debugSession: VsCode.VsCodeDebugSession["Type"]) =>
  Effect.gen(function*() {
    const debugRequest = <A = never>(command: string, args?: any) =>
      VsCode.thenableCatch<A, DebugChannelError>(
        () => {
          return debugSession.customRequest(command, args)
        },
        (error) => {
          return new DebugChannelError({ message: String(error) + " " + (args ? JSON.stringify(args) : "undefined") })
        }
      )

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
              ast.types.map((typeAST) => extractValue(dapVariableReference, typeAST))
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
              return extractValue(indexProperty, elementAst.type).pipe(
                Effect.catchTag(
                  "DebugChannelError",
                  (e) => new DebugChannelError({ message: "at index " + index + " " + e.message })
                )
              )
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
              ).pipe(
                Effect.catchTag(
                  "DebugChannelError",
                  (e) =>
                    new DebugChannelError({
                      message: "in property " + String(propertySignature.name) + " " + e.message
                    })
                )
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
      evaluateOnEveryExecutionContext: (_opts) =>
        Effect.gen(function*() {
          const addr = yield* VsCode.executeCommand<{ host: string; port: number; path?: string }>(
            "extension.js-debug.requestCDPProxy",
            debugSession.id
          )
          const uri = `ws://${addr.host}:${addr.port}${addr.path || ""}`

          const cdpSocket = yield* Socket.fromWebSocket(
            Effect.sync(() => {
              const wss = new ws.WebSocket(uri, {
                perMessageDeflate: false,
                maxPayload: 256 * 1024 * 1024
              })

              return wss as any
            })
          )

          yield* run(
            cdpSocket,
            Effect.fn(function*(client) {
              // we enable reporting of execution contexts
              yield* client.request({
                method: "Runtime.enable"
              })

              while (true) {
                const response = yield* client.queue.take
                if (
                  Predicate.hasProperty(response, "method") && response.method === "Runtime.executionContextCreated" &&
                  Predicate.hasProperty(response, "params") && Predicate.hasProperty(response.params, "context") &&
                  Predicate.hasProperty(response.params.context, "id")
                ) {
                  const contextId = response.params.context.id

                  // we send as notification and silent because we don't want to pollute the output
                  yield* client.request({
                    method: "Runtime.evaluate",
                    params: {
                      expression: _opts.expression,
                      contextId,
                      silent: true
                    }
                  })
                }
              }
            })
          )
        }).pipe(
          Effect.scoped,
          Effect.timeoutTo({
            onTimeout: Function.constUndefined,
            onSuccess: Function.identity,
            duration: 1000
          }),
          Effect.catchAll((socketError) => {
            return new DebugChannelError({ message: String(socketError) })
          })
        ),
      evaluate: (opts) =>
        Effect.gen(function*() {
          let request: any = {
            expression: opts.expression,
            context: "repl"
          }
          if (opts.guessFrameId) {
            let threadId = opts.threadId
            if (threadId === undefined) {
              const threads = yield* debugRequest<DapThreadsResponse>("threads")
              const thread = threads.threads[0]
              if (thread) threadId = thread.id
            }
            if (threadId !== undefined) {
              const stackTraces = yield* debugRequest<DapStackTracesResponse>("stackTrace", {
                threadId
              })
              const stackTrace = stackTraces.stackFrames[0]
              if (stackTrace) {
                request = {
                  expression: opts.expression,
                  context: "repl",
                  frameId: stackTrace.id
                }
              }
            }
          }
          const response = yield* debugRequest<DapEvaluateResponse>("evaluate", request)
          return makeVariableReference({
            name: "",
            value: response.result,
            type: response.type,
            variablesReference: response.variablesReference
          })
        })
    })
  })
