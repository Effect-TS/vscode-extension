export function addSetInterceptor<O extends object, K extends keyof O>(
  obj: O,
  key: K,
  onSet: (v: O[K]) => void
) {
  const previousProperty = Object.getOwnPropertyDescriptor(obj, key)
  if (previousProperty && previousProperty.set) {
    Object.defineProperty(obj, key, {
      "value": previousProperty.value,
      "writable": previousProperty.writable,
      "enumerable": previousProperty.enumerable,
      "configurable": previousProperty.configurable,
      "get": previousProperty.get,
      "set"(this: O, _: O[K]) {
        onSet(_)
        previousProperty.set?.bind(this)(_)
      }
    })
  } else {
    let _val: O[K]
    Object.defineProperty(obj, key, {
      "set"(this: O, _: O[K]) {
        _val = _
        onSet(_)
      },
      "get"() {
        return _val
      }
    })
  }
}
