export function addSetInterceptor<T extends object, K extends keyof T>(
  obj: T,
  property: K,
  interceptor: (value: T[K]) => void
): void {
  const descriptor = Object.getOwnPropertyDescriptor(obj, property)

  const previousSetter = descriptor?.set

  let currentValue: T[K]
  const previousGetter = descriptor?.get

  if (!previousGetter) {
    currentValue = obj[property]
  }

  globalThis.Object.defineProperty(obj, property, {
    get(): T[K] {
      if (previousGetter) {
        return previousGetter.call(obj)
      }
      return currentValue
    },
    set(value: T[K]) {
      if (previousSetter) {
        previousSetter.call(obj, value)
      } else {
        currentValue = value
      }
      interceptor(value)
    },
    enumerable: descriptor?.enumerable ?? true,
    configurable: descriptor?.configurable ?? true
  })
}
