import { Duration } from "effect"

export const format = (self: Duration.Duration) => {
  const nanos = Number(Duration.unsafeToNanos(self))

  if (nanos < 1_000) {
    return `${nanos}ns`
  } else if (nanos < 1_000_000) {
    return `${(nanos / 1_000).toFixed(2)}µs`
  } else if (nanos < 1_000_000_000) {
    return `${(nanos / 1_000_000).toFixed(2)}ms`
  } else {
    return `${(nanos / 1_000_000_000).toFixed(2)}s`
  }
}
