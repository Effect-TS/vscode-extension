import { compiledInstrumentationString } from "@effect/devtools-shared/DevtoolDebugBridgeString.generated"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineConfig } from "tsup"
import * as Contributes from "./src/contributes.ts"

export default defineConfig({
  entry: ["src/extension.ts"],
  outDir: "dist",
  clean: false,
  sourcemap: true,
  external: ["vscode"],
  treeshake: "smallest",
  onSuccess: () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      // copy instrumentation
      const instrumentationPath = path.join(__dirname, "dist", "instrumentation.global.js")
      yield* fs.writeFileString(instrumentationPath, compiledInstrumentationString)

      // read and writes contributes
      const contributes = yield* Contributes.getContributesObject
      const packageJsonPath = path.join(__dirname, "package.json")
      const packageJson = yield* fs.readFileString(packageJsonPath)
      const packageJsonObject = yield* Schema.decodeUnknown(Schema.parseJson(Schema.Record({
        key: Schema.String,
        value: Schema.Unknown
      })))(packageJson)
      const newPackageJsonObject = {
        ...packageJsonObject,
        contributes
      }
      yield* fs.writeFileString(packageJsonPath, JSON.stringify(newPackageJsonObject, null, 2))
    }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)
})
