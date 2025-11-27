/**
 * @since 1.0.0
 */

/**
 * Represents a string literal value in the when clause AST.
 *
 * @since 1.0.0
 * @category models
 */
export interface StringLiteral {
  readonly _tag: "StringLiteral"
  readonly value: string
}

/**
 * Represents a boolean literal value in the when clause AST.
 *
 * @since 1.0.0
 * @category models
 */
export interface BooleanLiteral {
  readonly _tag: "BooleanLiteral"
  readonly value: boolean
}

/**
 * Represents a string value from environment in the when clause AST.
 *
 * @since 1.0.0
 * @category models
 */
export interface StringFromEnv {
  readonly _tag: "StringFromEnv"
  readonly name: string
}

/**
 * Represents a boolean value from environment in the when clause AST.
 *
 * @since 1.0.0
 * @category models
 */
export interface BooleanFromEnv {
  readonly _tag: "BooleanFromEnv"
  readonly name: string
}

/**
 * Represents an equality comparison between two AST nodes.
 *
 * @since 1.0.0
 * @category models
 */
export interface EqualsComparison {
  readonly _tag: "EqualsComparison"
  readonly left: ExtWhenClauseAST
  readonly right: ExtWhenClauseAST
}

/**
 * Represents a logical AND expression between two AST nodes.
 *
 * @since 1.0.0
 * @category models
 */
export interface AndExpression {
  readonly _tag: "AndExpression"
  readonly left: ExtWhenClauseAST
  readonly right: ExtWhenClauseAST
}

/**
 * Represents a logical OR expression between two AST nodes.
 *
 * @since 1.0.0
 * @category models
 */
export interface OrExpression {
  readonly _tag: "OrExpression"
  readonly left: ExtWhenClauseAST
  readonly right: ExtWhenClauseAST
}

/**
 * Represents a parenthesized expression.
 *
 * @since 1.0.0
 * @category models
 */
export interface ParenthesizedExpression {
  readonly _tag: "ParenthesizedExpression"
  readonly expression: ExtWhenClauseAST
}

/**
 * Union type representing all possible when clause AST nodes.
 *
 * @since 1.0.0
 * @category models
 */
export type ExtWhenClauseAST =
  | StringLiteral
  | BooleanLiteral
  | StringFromEnv
  | BooleanFromEnv
  | EqualsComparison
  | AndExpression
  | OrExpression
  | ParenthesizedExpression

/**
 * @since 1.0.0
 * @category constructors
 */
export const stringLiteral = (value: string): StringLiteral => ({
  _tag: "StringLiteral",
  value
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const booleanLiteral = (value: boolean): BooleanLiteral => ({
  _tag: "BooleanLiteral",
  value
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const stringFromEnv = (name: string): StringFromEnv => ({
  _tag: "StringFromEnv",
  name
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const booleanFromEnv = (name: string): BooleanFromEnv => ({
  _tag: "BooleanFromEnv",
  name
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const equalsComparison = (left: ExtWhenClauseAST, right: ExtWhenClauseAST): EqualsComparison => ({
  _tag: "EqualsComparison",
  left,
  right
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const andExpression = (left: ExtWhenClauseAST, right: ExtWhenClauseAST): AndExpression => ({
  _tag: "AndExpression",
  left,
  right
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const orExpression = (left: ExtWhenClauseAST, right: ExtWhenClauseAST): OrExpression => ({
  _tag: "OrExpression",
  left,
  right
})

/**
 * @since 1.0.0
 * @category constructors
 */
export const parenthesizedExpression = (expression: ExtWhenClauseAST): ParenthesizedExpression => ({
  _tag: "ParenthesizedExpression",
  expression
})
