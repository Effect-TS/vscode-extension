import * as ExtWhenClause from "./core/ExtWhenClause.ts"

export const inDebugMode = ExtWhenClause.booleanFromEnv("inDebugMode")
export const running = ExtWhenClause.booleanFromEnv("effect:running")
export const hasClients = ExtWhenClause.booleanFromEnv("effect:hasClients")
export const spanStackIgnoreListEnabled = ExtWhenClause.booleanFromEnv("effect:spanStackIgnoreListEnabled")
export const hasDebugTargets = ExtWhenClause.booleanFromEnv("effect:hasDebugTargets")
