import * as ExtHostDebugger from "@effect/devtools-shared/core/ExtHostDebugger"
import * as ExtHostDebuggerConnection from "@effect/devtools-shared/core/ExtHostDebuggerConnection"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Function from "effect/Function"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import * as ScopedRef from "effect/ScopedRef"
import * as SubscriptionRef from "effect/SubscriptionRef"

class EvalDpVariable extends Schema.Class<EvalDpVariable>("EvalDpVariable")({
  executionId: Schema.Number,
  variableId: Schema.Number,
  type: Schema.String,
  name: Schema.String,
  value: Schema.Union(Schema.Number, Schema.Boolean, Schema.String, Schema.Null, Schema.Undefined),
  isContainer: Schema.Boolean
}) {}

function makeDebugSession() {
  return Effect.gen(function*() {
    // create the session
    const events = yield* PubSub.sliding<ExtHostDebuggerConnection.DebuggerEvent>({ capacity: 16, replay: 1 })
    yield* events.offer(new ExtHostDebuggerConnection.DebuggerThreadStopped({}))
    yield* Effect.addFinalizer(() => events.shutdown)

    const evaluateOnInspected = (expression: string) => {
      return Effect.async<unknown, ExtHostDebuggerConnection.DebugConnectionError>((resume) => {
        chrome.devtools.inspectedWindow.eval(
          expression,
          (result, error) =>
            error
              ? resume(
                Effect.fail(
                  new ExtHostDebuggerConnection.DebugConnectionError({
                    message: "eval error: " + JSON.stringify(error)
                  })
                )
              )
              : resume(Effect.succeed(result))
        )
      })
    }

    const getMetadataScript = `function(executionId, variableId){
      var resultMap = globalThis["effect/devtools-bridge/result"] || new globalThis.Map();
      var nameAndValue = resultMap.get(executionId).get(variableId);
      var value = nameAndValue[1]();
      return {
        executionId: executionId,
        variableId: variableId,
        type: typeof value,
        name: nameAndValue[0],
        value: typeof value === "number" || typeof value === "boolean" || typeof value === "undefined" || value === null ? value : globalThis.String(value),
        isContainer: typeof value === "object" && value !== null
      };
  }`
    function evaluateScriptMetadata(executionId: number, variableId: number): Effect.Effect<
      EvalDpVariable,
      ExtHostDebuggerConnection.DebugConnectionError,
      never
    > {
      return Effect.gen(function*() {
        const metadata = yield* evaluateOnInspected(`(${getMetadataScript})(${executionId}, ${variableId})`)
        return yield* Schema.decodeUnknown(EvalDpVariable)(metadata)
      }).pipe(
        Effect.catchTag(
          "ParseError",
          (cause) => Effect.fail(new ExtHostDebuggerConnection.DebugConnectionError({ cause, message: String(cause) }))
        )
      )
    }

    function evaluateScriptChildren(
      executionId: number,
      variableId: number
    ): Effect.Effect<ReadonlyArray<number>, ExtHostDebuggerConnection.DebugConnectionError, never> {
      return Effect.gen(function*() {
        const getChildrenScript = `(function(executionId, variableId){
          var resultMap = globalThis["effect/devtools-bridge/result"] || new globalThis.Map();
          var nameAndValue = resultMap.get(executionId).get(variableId);
          var value = nameAndValue[1]();
          if(value === null) return []
          if(typeof value !== "object") return []
          function appendChild(keyValue){
            var newId = resultMap.get(executionId).size;
            resultMap.get(executionId).set(newId, [keyValue, function(){ return value[keyValue]; }]);
            return newId;
          }
          return globalThis.Object.getOwnPropertyNames(value).map(appendChild);
      })(${executionId}, ${variableId})`
        const children = yield* evaluateOnInspected(getChildrenScript)
        return yield* Schema.decodeUnknown(Schema.Array(Schema.Number))(children)
      }).pipe(
        Effect.catchTag(
          "ParseError",
          (cause) => Effect.fail(new ExtHostDebuggerConnection.DebugConnectionError({ cause, message: String(cause) }))
        )
      )
    }

    const extractExpressionCache = new WeakMap<SchemaAST.AST, { expression: string; filter: string }>()
    function evaluateExtract(
      executionId: number,
      variableId: number,
      ast: SchemaAST.AST
    ): Effect.Effect<any, ExtHostDebuggerConnection.DebugConnectionError, never> {
      return Effect.gen(function*() {
        let extractExpression = extractExpressionCache.get(ast)
        if (!extractExpression) extractExpression = yield* createExtractExpression(ast, `value`, "")
        extractExpressionCache.set(ast, extractExpression)
        return yield* evaluateOnInspected(`(function(executionId, variableId){
          var resultMap = globalThis["effect/devtools-bridge/result"] || new globalThis.Map();
          var nameAndValue = resultMap.get(executionId).get(variableId);
          var value = nameAndValue[1]();
          var intoVariableReference = function(varName, varValue){
            var newId = resultMap.get(executionId).size;
            resultMap.get(executionId).set(newId, [varName, function(){ return varValue; }]);
            return (${getMetadataScript})(executionId, newId);
          }
          return ${extractExpression.filter} ? (${extractExpression.expression}) : ({_tag: "unexpected", value: ${
          JSON.stringify(extractExpression.expression)
        } });
      })(${executionId}, ${variableId})`)
      })
    }

    let tmpIdx = 0
    const createExtractExpression = (
      ast: SchemaAST.AST,
      rootExpression: string,
      nameExpression: string
    ): Effect.Effect<{
      expression: string
      filter: string
    }, ExtHostDebuggerConnection.DebugConnectionError> => {
      return Effect.gen(function*() {
        const localIdx = tmpIdx++
        switch (ast._tag) {
          case "Suspend": {
            return yield* createExtractExpression(ast.f(), rootExpression, nameExpression)
          }
          case "Transformation": {
            return yield* createExtractExpression(ast.from, rootExpression, nameExpression)
          }
          case "Refinement": {
            return yield* createExtractExpression(ast.from, rootExpression, nameExpression)
          }
          case "StringKeyword": {
            return {
              expression: rootExpression,
              filter: `typeof ${rootExpression} === "string"`
            }
          }
          case "BooleanKeyword": {
            return {
              expression: rootExpression,
              filter: `typeof ${rootExpression} === "boolean"`
            }
          }
          case "NumberKeyword": {
            return {
              expression: rootExpression,
              filter: `typeof ${rootExpression} === "number"`
            }
          }
          case "Literal": {
            return {
              expression: rootExpression,
              filter: `(typeof ${rootExpression} === "string" && ${rootExpression} === ${JSON.stringify(ast.literal)})`
            }
          }
          case "Union": {
            const members = yield* Effect.all(
              ast.types.map((typeAST) => createExtractExpression(typeAST, rootExpression, nameExpression)),
              { concurrency: "unbounded" }
            )
            return {
              expression: Array.reduce(members.splice(1), members[0].expression, (acc, member) => {
                return `(${member.filter} ? ${member.expression} : ${acc})`
              }),
              filter: `(${members.map((member) => member.filter).join(" || ")})`
            }
          }
          case "TypeLiteral": {
            const filters: Array<string> = []
            const expressions: Array<string> = []
            for (const propertySignature of ast.propertySignatures) {
              if (typeof propertySignature.name !== "string") {
                return yield* new ExtHostDebuggerConnection.DebugConnectionError({
                  message: "Expected property name to be a string"
                })
              }
              const memberTest = yield* createExtractExpression(
                propertySignature.type,
                `${rootExpression}[${JSON.stringify(propertySignature.name)}]`,
                JSON.stringify(propertySignature.name)
              )
              filters.push(
                `(${JSON.stringify(propertySignature.name)} in ${rootExpression} && ${memberTest.filter})`
              )
              expressions.push(`${JSON.stringify(propertySignature.name)}: ${memberTest.expression}`)
            }
            if (filters.length === 0) {
              return {
                expression: rootExpression,
                filter: `typeof ${rootExpression} === "object" && ${rootExpression} !== null`
              }
            }
            return {
              expression: `{ ${expressions.join(", ")} }`,
              filter: `(typeof ${rootExpression} === "object" && ${rootExpression} !== null && ${filters.join(" && ")})`
            }
          }
          case "TupleType": {
            const filters: Array<string> = []
            const expressions: Array<string> = []
            const restExpressions: Array<string> = []
            let elementIdx = 0
            filters.push(
              `typeof ${rootExpression} === "object" && ${rootExpression} !== null && "map" in ${rootExpression}`
            )
            if (ast.elements.length > 0) filters.push(`${rootExpression}.length >= ${ast.elements.length}`)
            for (const element of ast.elements) {
              const elementTest = yield* createExtractExpression(
                element.type,
                `${rootExpression}[${elementIdx}]`,
                String(elementIdx)
              )
              elementIdx++
              filters.push(elementTest.filter)
              expressions.push(elementTest.expression)
            }
            for (const rest of ast.rest) {
              const restTest = yield* createExtractExpression(rest.type, `el${localIdx}`, `idx${localIdx}`)
              elementIdx++
              restExpressions.push(
                `${rootExpression}.map(function(el${localIdx}, idx${localIdx}){ return ${restTest.expression}; })`
              )
            }
            return {
              expression: Array.reduce(restExpressions, `[${expressions.join(", ")}]`, (acc, expression) => {
                return `${acc}.concat(${expression})`
              }),
              filter: `(${filters.join(" && ")})`
            }
          }
          default: {
            const identifier = SchemaAST.getIdentifierAnnotation(ast)
            if (Option.isSome(identifier) && identifier.value === "VariableReference") {
              return {
                expression: `intoVariableReference(${nameExpression}, ${rootExpression})`,
                filter: `true`
              }
            }
            return yield* new ExtHostDebuggerConnection.DebugConnectionError({
              message: `Unsupported schema type: ${ast._tag}`
            })
          }
        }
      })
    }

    function makeVariableReference(
      evalDpVariable: EvalDpVariable
    ): ExtHostDebuggerConnection.VariableReference {
      return new ExtHostDebuggerConnection.VariableReference({
        name: evalDpVariable.name,
        value: String(evalDpVariable.value),
        isContainer: evalDpVariable.isContainer,
        children: evaluateScriptChildren(evalDpVariable.executionId, evalDpVariable.variableId).pipe(
          Effect.flatMap((_) =>
            Effect.forEach(
              _,
              (variableId) =>
                evaluateScriptMetadata(evalDpVariable.executionId, variableId).pipe(
                  Effect.map(makeVariableReference)
                ),
              { concurrency: "unbounded" }
            )
          )
        ),
        parse: (_schema) =>
          Effect.gen(function*() {
            const rawInput = yield* evaluateExtract(
              evalDpVariable.executionId,
              evalDpVariable.variableId,
              _schema.ast
            )
            return yield* Schema.decodeUnknown(_schema)(rawInput)
          }).pipe(
            Effect.provideService(ExtHostDebuggerConnection.VariableReferenceConstructor, {
              make: makeVariableReference
            })
          )
      })
    }

    const evaluate = (expression: string) =>
      Effect.gen(function*() {
        const storeResultOnGlobal = `(function(){
          var resultMap = globalThis["effect/devtools-bridge/result"] || new globalThis.Map();
          globalThis["effect/devtools-bridge/result"] = resultMap;
          var executionId = resultMap.size;
          var result = (${expression});
          resultMap.set(executionId, new globalThis.Map([[0, ["", function(){ return result; }]]]));
          return { executionId: executionId, variableMetadata: (${getMetadataScript})(executionId, 0) };
      })()`
        const result = yield* evaluateOnInspected(storeResultOnGlobal)
        const { executionId, variableMetadata } = yield* Schema.decodeUnknown(Schema.Struct({
          executionId: Schema.Number,
          variableMetadata: EvalDpVariable
        }))(result)

        // we delete the result from the globalThis object on the inspected window when the connection is closed
        yield* Effect.addFinalizer(() =>
          evaluateOnInspected(
            `(globalThis["effect/devtools-bridge/result"] || new globalThis.Map()).set(${executionId}, undefined)`
          ).pipe(Effect.ignoreLogged)
        )
        return makeVariableReference(variableMetadata)
      }).pipe(
        Effect.catchTag(
          "ParseError",
          (cause) => Effect.fail(new ExtHostDebuggerConnection.DebugConnectionError({ cause, message: String(cause) }))
        )
      )

    const tabName = yield* Effect.tryPromise({
      try: () => chrome.tabs.query({ active: true, currentWindow: true }),
      catch: (error) => (new ExtHostDebuggerConnection.DebugConnectionError({ cause: error, message: String(error) }))
    }).pipe(
      Effect.map((tabs) => tabs[0].title || "inspectedWindow")
    )

    return Function.identity<ExtHostDebuggerConnection.ExtHostDebuggerConnection>({
      name: tabName,
      events,
      evaluate: (opts) => evaluate(opts.expression)
    })
  })
}

export const ChromeExtHostDebugger = Layer.scoped(
  ExtHostDebugger.ExtHostDebugger,
  Effect.gen(function*() {
    const activeConnection = yield* SubscriptionRef.make(
      Option.none<ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
    )
    const connections = yield* SubscriptionRef.make(
      Array.empty<ExtHostDebuggerConnection.ExtHostDebuggerConnection>()
    )

    const inspectedWindowRef = yield* ScopedRef.fromAcquire(Effect.void)
    const captureInspectedWindow = ScopedRef.set(
      inspectedWindowRef,
      Effect.gen(function*() {
        const inspectedWindow = yield* makeDebugSession()
        yield* SubscriptionRef.set(activeConnection, Option.some(inspectedWindow))
        yield* SubscriptionRef.set(connections, [inspectedWindow])
        yield* Effect.addFinalizer(() => SubscriptionRef.set(activeConnection, Option.none()))
        yield* Effect.addFinalizer(() => SubscriptionRef.set(connections, []))
      })
    )

    yield* captureInspectedWindow.pipe(
      Effect.ignoreLogged,
      Effect.forkScoped
    )

    return ExtHostDebugger.ExtHostDebugger.of({
      activeConnection,
      connections
    })
  })
)
