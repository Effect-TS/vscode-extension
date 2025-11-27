import { htmlString as ConfigWebViewHtml } from "@effect/devtools-shared/webviews/config.generated"
import { htmlString as ContainerWebViewHtml } from "@effect/devtools-shared/webviews/container.generated"
import { htmlString as TracerWebViewHtml } from "@effect/devtools-shared/webviews/tracer.generated"
import { htmlString as TreeWebViewHtml } from "@effect/devtools-shared/webviews/tree.generated"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { defineConfig } from "tsup"

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
      const tracerComponentPath = path.join(__dirname, "dist", "ui-tracer.html")
      yield* fs.writeFileString(tracerComponentPath, TracerWebViewHtml)

      const treeComponentPath = path.join(__dirname, "dist", "ui-tree.html")
      yield* fs.writeFileString(treeComponentPath, TreeWebViewHtml)

      const containerComponentPath = path.join(__dirname, "dist", "ui-container.html")
      yield* fs.writeFileString(containerComponentPath, ContainerWebViewHtml)

      const configComponentPath = path.join(__dirname, "dist", "ui-config.html")
      yield* fs.writeFileString(configComponentPath, ConfigWebViewHtml)

      // write devtools.html
      const devtoolsHtmlPath = path.join(__dirname, "dist", "devtools.html")
      yield* fs.writeFileString(
        devtoolsHtmlPath,
        `
<html>
  <body>
    <script src="extension.cjs"></script>
  </body>
</html>
      `
      )

      const packageJsonPath = path.join(__dirname, "package.json")
      const packageJsonText = yield* fs.readFileString(packageJsonPath)
      const packageJsonSchema = Schema.Struct({
        name: Schema.String,
        version: Schema.String,
        description: Schema.String
      })
      const packageJsonObject = yield* Schema.decodeUnknown(Schema.parseJson(packageJsonSchema))(packageJsonText)

      // write manifest.json
      const manifestObject = {
        ...packageJsonObject,
        devtools_page: "devtools.html",
        manifest_version: 3,
        sandbox: {
          pages: [
            "ui-tracer.html",
            "ui-tree.html",
            "ui-container.html",
            "ui-config.html"
          ]
        },
        web_accessible_resources: [
          {
            resources: [
              "ui-tracer.html",
              "ui-tree.html",
              "ui-container.html",
              "ui-config.html"
            ],
            matches: ["<all_urls>"],
            extension_ids: []
          }
        ],
        permissions: [
          "debugger",
          "tabs",
          "activeTab",
          "storage"
        ]
      }
      const manifestPath = path.join(__dirname, "dist", "manifest.json")
      yield* fs.writeFileString(
        manifestPath,
        JSON.stringify(manifestObject, null, 2)
      )
    }).pipe(Effect.provide(NodeContext.layer), Effect.runPromise)
})
