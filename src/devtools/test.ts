import * as Effect from "effect/Effect"
import * as Commands from "./commands"
import * as Configs from "./configs"

const revealFile = Commands.StartServer.toLayer(Effect.gen(function*() {
  return (_args) => Effect.succeed(undefined)
}))

const program = Effect.gen(function*() {
  const config = yield* Configs.DevServerPort.get
  const command = yield* Commands.StartServer.execute({})
  console.log(config)
})
