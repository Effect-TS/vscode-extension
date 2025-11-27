import * as NodeContext from "@effect/platform-node/NodeContext"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import react from "@vitejs/plugin-react"
import * as Effect from "effect/Effect"
import { fileURLToPath } from "node:url"
import path from "path"
import { build, defineConfig, type PluginOption } from "vite"
import { viteSingleFile } from "./vite-single-file.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getConfing(name: string) {
  const copyOnEnd: PluginOption = {
    name: "copy-on-end",
    enforce: "post",
    generateBundle: (_, bundle) =>
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const messagesPath = path.join(__dirname, "..", "src", name, "messages.ts")
        const messagesCode = yield* fs.readFileString(messagesPath)
        const generatedPath = path.join(__dirname, "..", "..", "shared", "src", "webviews", name + ".generated.ts")
        const bundleIdx = Object.keys(bundle).find((key) => key.endsWith(".html"))
        if (!bundleIdx) return
        const code = bundle[bundleIdx].type == "chunk" ? bundle[bundleIdx].code : bundle[bundleIdx].source
        yield* fs.writeFileString(
          generatedPath,
          `/* eslint-disable @effect/dprint */\n${messagesCode}\nexport const htmlString = ${JSON.stringify(code)}`
        )
      }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)
  }

  return defineConfig({
    plugins: [
      react({
        babel: {
          plugins: ["babel-plugin-react-compiler"]
        }
      }),
      viteSingleFile(),
      copyOnEnd
    ],
    build: {
      minify: false,
      sourcemap: false,
      outDir: path.join(__dirname, "..", "dist"),
      rollupOptions: {
        input: {
          [name]: path.resolve(__dirname, "..", `ui-${name}.html`)
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name].[ext]"
        }
      }
    }
  })
}

async function main() {
  for (const name of ["tracer", "tree", "container", "config"]) {
    await build(getConfing(name))
  }
}

main()
