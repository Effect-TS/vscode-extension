import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Effect from "effect/Effect"
import * as DevtoolTreeView from "../core/DevtoolTreeView"
import * as Commands from "./commands"
import * as Configs from "./configs"

const revealFile = Commands.StartServer.toLayer(Effect.gen(function*() {
  return (_args) => Effect.succeed(undefined)
}))

const FileTreeView = DevtoolTreeView.make("file").setItemSchema(Domain)

const provider = FileTreeView.toLayer(Effect.gen(function*() {
  return (_parent) => Effect.succeed([])
}))

const program = Effect.gen(function*() {
  const config = yield* Configs.DevServerPort.get
  const command = yield* Commands.StartServer.execute({})
  console.log(config)
})
