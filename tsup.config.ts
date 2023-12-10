import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/extension.ts"],
  outDir: "out",
  clean: true,
  external: ["vscode"],
  treeshake: "smallest",
  sourcemap: true,
})
