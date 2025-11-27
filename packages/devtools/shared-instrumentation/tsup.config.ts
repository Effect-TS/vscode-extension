import * as NodeContext from "@effect/platform-node/NodeContext"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Effect from "effect/Effect"
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  external: ["effect"],
  clean: true,
  publicDir: true,
  format: "iife",
  target: "es5",
  treeshake: "smallest",
  onSuccess: () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const compiledPath = path.join(__dirname, "dist", "index.global.js")
      const outputPath = path.join(__dirname, "..", "shared", "src", "DevtoolDebugBridgeString.generated.ts")
      const compiled = yield* fs.readFileString(compiledPath)
      const code =
        `(function(){ var Array = globalThis.Array; var Object = globalThis.Object; var String = globalThis.String; var Date = globalThis.Date; \n${compiled}} )()`
      yield* fs.writeFileString(
        outputPath,
        `/* eslint-disable @effect/dprint */\nexport const compiledInstrumentationString = ${JSON.stringify(code)}`
      )
    }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)
})
