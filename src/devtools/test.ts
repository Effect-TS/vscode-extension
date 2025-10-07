import * as Effect from "effect/Effect"
import * as Configs from "./configs"

const program = Effect.gen(function*() {
  const config = yield* Configs.DevServerPort.get
  console.log(config)
})
