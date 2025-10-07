/**
 * @since 1.0.0
 */

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/DevtoolIcon")

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
export interface DevtoolIcon {
  readonly [TypeId]: TypeId
  readonly name: string
}

/**
 * @since 1.0.0
 * @category guards
 */
export const isDevtoolIcon = (u: unknown): u is DevtoolIcon => typeof u === "object" && u !== null && TypeId in u

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = (name: string): DevtoolIcon => ({
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
