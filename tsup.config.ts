import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/extension.ts"],
  outDir: "out",
  clean: false,
  sourcemap: true,
  external: ["vscode"],
  treeshake: "smallest"
})
