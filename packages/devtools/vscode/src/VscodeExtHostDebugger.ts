import * as ExtHostDebugger from "@effect/devtools-shared/core/ExtHostDebugger"
import * as ExtHostDebuggerConnection from "@effect/devtools-shared/core/ExtHostDebuggerConnection"
import * as ChannelSchema from "@effect/platform/ChannelSchema"
import * as Socket from "@effect/platform/Socket"
import * as Array from "effect/Array"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as ParseResult from "effect/ParseResult"
import * as Predicate from "effect/Predicate"
import * as PubSub from "effect/PubSub"
import * as Runtime from "effect/Runtime"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import * as ws from "ws"
import * as VsCode from "./VsCode.ts"

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
export const e = Effect.gen(function*() {
  const timeout = yield* Deferred.make<never, Cause.TimeoutException>()
  const addr = yield* VsCode.executeCommand<{ host: string; port: number; path?: string }>(
    "extension.js-debug.requestCDPProxy",
    1 // debugSession.id
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
      yield* Deferred.fail(timeout, new Cause.TimeoutException()).pipe(Effect.delay(1000), Effect.forkScoped)

      while (true) {
        yield* Effect.log("wait...")
        const response = yield* Effect.raceFirst(client.queue.take, Deferred.await(timeout))
        yield* Effect.log("in ", response)
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
              expression: "",
              contextId,
              silent: true
            }
          })
        }
      }
    })
  )
}).pipe(
  Effect.uninterruptible,
  Effect.scoped
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

export const makeVsCodeDebugSession = (debugSession: vscode.DebugSession) =>
  Effect.gen(function*() {
    const events = yield* PubSub.sliding<ExtHostDebuggerConnection.DebuggerEvent>({ capacity: 16, replay: 1 })

    const debugRequest = <A = never>(command: string, args?: any) =>
      VsCode.thenableCatch<A, ExtHostDebuggerConnection.DebugConnectionError>(
        () => {
          return debugSession.customRequest(command, args)
        },
        (cause) => {
          return new ExtHostDebuggerConnection.DebugConnectionError({
            cause,
            message: String(cause) + " " + (args ? JSON.stringify(args) : "undefined")
          })
        }
      )

    const extractValue = (
      dapVariableReference: DapVariableReference,
      ast: SchemaAST.AST
    ): Effect.Effect<any, ExtHostDebuggerConnection.DebugConnectionError | ParseResult.ParseError, never> =>
      Effect.gen(function*() {
        switch (ast._tag) {
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
            if (ast._tag === "Literal" && ast.literal !== stringValue) {
              return yield* Effect.fail(
                new ParseResult.ParseError({
                  issue: new ParseResult.Type(ast, undefined, `Expected literal ${ast.literal} to be ${stringValue}`)
                })
              )
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
                return new ParseResult.ParseError({
                  issue: new ParseResult.Type(
                    ast,
                    undefined,
                    `Expected index ${index} to be present in the reference`
                  )
                })
              }
              const elementAst = index < ast.elements.length ? ast.elements[index] : ast.rest[0]
              return extractValue(indexProperty, elementAst.type).pipe(
                Effect.catchTag(
                  "ParseError",
                  (cause) =>
                    new ParseResult.ParseError({
                      issue: new ParseResult.Type(
                        ast,
                        undefined,
                        `at index ${index} ${cause.message}`
                      )
                    })
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
              Effect.Effect<any, ExtHostDebuggerConnection.DebugConnectionError | ParseResult.ParseError, never>
            > = {}

            for (const propertySignature of ast.propertySignatures) {
              if (typeof propertySignature.name !== "string") {
                return yield* new ParseResult.ParseError({
                  issue: new ParseResult.Type(ast, undefined, `Expected property name to be a string`)
                })
              }
              const propertyVariableReference = variables.find(
                (variable) => variable.name === propertySignature.name
              )
              if (!propertyVariableReference) {
                return yield* new ParseResult.ParseError({
                  issue: new ParseResult.Type(
                    propertySignature.type,
                    `Expected property ${propertySignature.name} to be present in the reference`
                  )
                })
              }
              result[propertySignature.name] = extractValue(
                propertyVariableReference,
                propertySignature.type
              ).pipe(
                Effect.catchTag(
                  "ParseError",
                  (cause) =>
                    new ParseResult.ParseError({
                      issue: new ParseResult.Type(
                        propertySignature.type,
                        undefined,
                        `in property ${String(propertySignature.name)} ${cause.message}`
                      )
                    })
                )
              )
            }
            return yield* Effect.all(result, { concurrency: "unbounded" })
          }
          case "Suspend": {
            return yield* extractValue(dapVariableReference, ast.f())
          }
          default: {
            const identifier = SchemaAST.getIdentifierAnnotation(ast)
            if (Option.isSome(identifier) && identifier.value === "VariableReference") {
              return dapVariableReference
            }
            return yield* new ExtHostDebuggerConnection.DebugConnectionError({
              message: `Unsupported schema type: ${ast._tag}`
            })
          }
        }
      })

    function makeVariableReference(
      dapVariableReference: DapVariableReference
    ): ExtHostDebuggerConnection.VariableReference {
      return new ExtHostDebuggerConnection.VariableReference({
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
          }).pipe(
            Effect.provideService(ExtHostDebuggerConnection.VariableReferenceConstructor, {
              make: makeVariableReference
            })
          ),
        name: dapVariableReference.name,
        value: dapVariableReference.value,
        isContainer: dapVariableReference.variablesReference !== 0
      })
    }

    const connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection = {
      name: debugSession.name,
      events,
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
            type: response.type!,
            variablesReference: response.variablesReference
          })
        })
    }
    return connection
  })

export const VscodeExtHostDebugger = Layer.scoped(
  ExtHostDebugger.ExtHostDebugger,
  Effect.gen(function*() {
    const context = yield* VsCode.VsCodeContext
    const runtime = yield* Effect.runtime<VsCode.VsCodeContext>()

    const activeConnection = yield* SubscriptionRef.make(
      Option.none<ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
    )
    const connections = yield* SubscriptionRef.make(
      Array.empty<ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
    )

    // ensure that a connection is set and exists for the given session
    const connectionsById = new Map<string, ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
    const semaphore = yield* Effect.makeSemaphore(1)
    const getOrCreateConnection = (session: vscode.DebugSession) =>
      Effect.gen(function*() {
        const existing = connectionsById.get(session.id)
        if (existing) return existing
        const connection = yield* makeVsCodeDebugSession(session)
        connectionsById.set(session.id, connection)
        yield* SubscriptionRef.update(connections, (connections) => [...connections, connection])
        return connection
      }).pipe(semaphore.withPermits(1))

    // on start, create a new connection
    context.subscriptions.push(
      vscode.debug.onDidStartDebugSession((session) => getOrCreateConnection(session).pipe(Runtime.runPromise(runtime)))
    )

    // on terminate, remove the connection
    context.subscriptions.push(
      vscode.debug.onDidTerminateDebugSession((session) =>
        Effect.gen(function*() {
          const connection = connectionsById.get(session.id)
          connectionsById.delete(session.id)
          if (connection) yield* connection.events.shutdown
          yield* SubscriptionRef.update(connections, (connections) => connections.filter((_) => _ !== connection))
        }).pipe(Runtime.runPromise(runtime))
      )
    )

    // on active, set the active connection
    context.subscriptions.push(
      vscode.debug.onDidChangeActiveDebugSession((session) =>
        Effect.gen(function*() {
          if (session) {
            const connection = yield* getOrCreateConnection(session)
            yield* SubscriptionRef.set(activeConnection, Option.some(connection))
          } else {
            yield* SubscriptionRef.set(activeConnection, Option.none())
          }
        }).pipe(Runtime.runPromise(runtime))
      )
    )

    // when an event happens, publish it
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker(_) {
          return {
            onDidSendMessage(message) {
              const connection = connectionsById.get(_.id)
              if (connection) {
                if (message.type === "event" && message.event === "stopped") {
                  connection.events.unsafeOffer(
                    new ExtHostDebuggerConnection.DebuggerThreadStopped({ threadId: message.body?.threadId })
                  )
                } else if (message.type === "event" && message.event === "continued") {
                  connection.events.unsafeOffer(
                    new ExtHostDebuggerConnection.DebuggerThreadContinued({
                      threadId: message.body?.threadId
                    })
                  )
                }
              }
            }
          }
        }
      })
    )
    return ExtHostDebugger.ExtHostDebugger.of({
      activeConnection,
      connections
    })
  })
)
