/**
 * @since 1.0.0
 */

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtIcon")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * Represents an icon for a devtool command.
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtIcon {
  readonly [TypeId]: TypeId
  readonly name: string
}

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtIcon = (u: unknown): u is ExtIcon => typeof u === "object" && u !== null && TypeId in u

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = (name: string): ExtIcon => ({
  [TypeId]: TypeId,
  name
})

/**
 * @since 1.0.0
 * @category icons
 */
export const play = make("play")

/**
 * @since 1.0.0
 * @category icons
 */
export const debugStop = make("debug-stop")

/**
 * @since 1.0.0
 * @category icons
 */
export const debug = make("debug")

/**
 * @since 1.0.0
 * @category icons
 */
export const refresh = make("refresh")

/**
 * @since 1.0.0
 * @category icons
 */
export const copy = make("copy")

/**
 * @since 1.0.0
 * @category icons
 */
export const goToFile = make("go-to-file")

/**
 * @since 1.0.0
 * @category icons
 */
export const eyeClosed = make("eye-closed")

/**
 * @since 1.0.0
 * @category icons
 */
export const eye = make("eye")

/**
 * @since 1.0.0
 * @category icons
 */
export const circle = make("circle")

/**
 * @since 1.0.0
 * @category icons
 */
export const circleFilled = make("circle-filled")

/**
 * @since 1.0.0
 * @category icons
 */
export const indent = make("indent")
