export interface Encoder<T> {
  (value: T): { _tag: "Success"; value: unknown } | { _tag: "Failure" } // TODO: probably a symbol would avoid excessive boxing?
}
const constFailure = { _tag: "Failure" as const }

export type Type<T> = T extends Encoder<infer _> ? _ : never

export const literal = <const T>(value: T): Encoder<T> => (givenValue) =>
  givenValue === value ? ({ _tag: "Success", value }) : constFailure
export const string: Encoder<string> = (value) => ({ _tag: "Success", value })
export const boolean: Encoder<boolean> = (value) => ({ _tag: "Success", value })
export const bigint: Encoder<bigint> = (value) => ({ _tag: "Success", value: globalThis.String(value) })

export const struct = <T extends object>(fields: { [K in keyof T]: Encoder<T[K]> }): Encoder<T> => {
  return (value) => {
    const properties: Array<[PropertyKey, unknown]> = []
    const entries = Object.entries(value)
    for (let i = 0; i < entries.length; i++) {
      const key = entries[i][0] as keyof T
      const prop = entries[i][1]
      const propResult = fields[key as keyof T](prop)
      if (propResult._tag === "Failure") return propResult
      properties.push([key, propResult.value])
    }
    return { _tag: "Success", value: Object.fromEntries(properties) }
  }
}

export const union = <T extends Array<Encoder<any>>>(...encoders: T): Encoder<Type<T[number]>> => (value) => {
  for (let i = 0; i < encoders.length; i++) {
    const memberResult = encoders[i](value)
    if (memberResult._tag === "Success") return memberResult
  }
  return constFailure
}

export const array = <T>(item: Encoder<T>): Encoder<Array<T>> => (value) => {
  if (typeof value === "object" && value !== null && Array.isArray(value)) {
    const result: Array<unknown> = []
    for (let i = 0; i < value.length; i++) {
      const itemResult = item(value[i])
      if (itemResult._tag === "Failure") return itemResult
      result.push(itemResult.value)
    }
    return { _tag: "Success", value: result }
  }
  return constFailure
}
