import { build } from "vite"
import { getConfing } from "./build.mts"

async function main() {
  for (const name of ["tracer", "tree", "container", "config"]) {
    await build(getConfing(name, true))
  }
}

main()
