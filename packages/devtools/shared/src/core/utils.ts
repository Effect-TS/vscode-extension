import type * as Readable from "effect/Readable"
import type * as Subscribable from "effect/Subscribable"

export type ReadableSubscribable<A> = Readable.Readable<A> & Subscribable.Subscribable<A>
