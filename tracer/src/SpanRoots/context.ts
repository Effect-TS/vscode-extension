import { createContext, useContext } from "react"
import { Span } from "./Span"

export const ActiveSpanContext = createContext<Span>(undefined as any)
export const useActiveSpan = () => useContext(ActiveSpanContext)
