export interface Decoder<T> {
  (value: unknown): { _tag: "Success"; value: T } | { _tag: "Failure" }
}

export type Type<T> = T extends Decoder<infer _> ? _ : never

const constFailure = { _tag: "Failure" as const }

export const string: Decoder<string> = (value) =>
  typeof value === "string" ? ({ _tag: "Success", value }) : constFailure
export const boolean: Decoder<boolean> = (value) =>
  typeof value === "boolean" ? ({ _tag: "Success", value }) : constFailure
export const literal = <const T>(literal: T): Decoder<T> => (value) =>
  value === literal ? ({ _tag: "Success", value: value as T }) : constFailure

export const array = <T>(item: Decoder<T>): Decoder<Array<T>> => (value) => {
  if (typeof value === "object" && value !== null && Array.isArray(value)) {
    const result: Array<T> = []
    for (let i = 0; i < value.length; i++) {
      const itemResult = item(value[i])
      if (itemResult._tag === "Failure") return itemResult
      result.push(itemResult.value)
    }
    return { _tag: "Success", value: result }
  }
  return constFailure
}

export const struct = <T extends object>(fields: { [K in keyof T]: Decoder<T[K]> }): Decoder<T> => {
  return (value) => {
    if (typeof value === "object" && value !== null) {
      const properties: Array<[PropertyKey, T[keyof T]]> = []
      const entries = Object.entries(value)
      for (let i = 0; i < entries.length; i++) {
        const key = entries[i][0] as keyof T
        const propValue = entries[i][1]
        const propResult = fields[key](propValue)
        if (propResult._tag === "Failure") return propResult
        properties.push([key, propResult.value])
      }
      return { _tag: "Success", value: Object.fromEntries(properties) as any }
    }
    return constFailure
  }
}

export const union = <T extends Array<Decoder<any>>>(...decoders: T): Decoder<Type<T[number]>> => (value) => {
  for (let i = 0; i < decoders.length; i++) {
    const memberResult = decoders[i](value)
    if (memberResult._tag === "Success") return memberResult
  }
  return constFailure
}
