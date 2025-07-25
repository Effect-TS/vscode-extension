import * as NodeContext from "@effect/platform-node/NodeContext"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Effect from "effect/Effect"
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/instrumentation/instrumentation.ts"],
  outDir: "out",
  format: "iife",
  clean: true,
  sourcemap: false,
  external: ["effect"],
  treeshake: "smallest",
  target: "es5",
  minify: false,
  onSuccess: () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const compiled = yield* fs.readFileString("out/instrumentation.global.js")
      yield* fs.writeFileString(
        path.join(__dirname, "src", "instrumentation", "instrumentation.compiled.ts"),
        `/* eslint-disable @effect/dprint */\nexport const compiledInstrumentationString = ${
          JSON.stringify(`(function(){ ${compiled}} )()`)
        }`
      )
    }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)
})
