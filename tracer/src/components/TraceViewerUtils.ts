export interface TraceEvent {
  id: string
  name: string
  startTime: bigint
  endTime: bigint
  color: string
  depth: number
}

export interface ViewState {
  startTime: bigint // Start time of visible range in nanoseconds
  endTime: bigint // End time of visible range in nanoseconds
  offsetY: number
}

export interface TraceViewerOptions {
  barHeight?: number
  barPadding?: number
  timelineHeight?: number
  minimapHeight?: number
}

// Utility function to get visible traces
export const getVisibleTraces = (
  traces: ReadonlyArray<TraceEvent>,
  viewState: ViewState,
  canvasHeight: number,
  options: TraceViewerOptions = {}
): TraceEvent[] => {
  const { barHeight = 30, barPadding = 4, timelineHeight = 25 } = options

  return traces.filter((trace) => {
    // Check horizontal visibility (time range)
    const traceStart = trace.startTime
    const traceEnd = trace.endTime
    const isVisibleHorizontally = traceEnd >= viewState.startTime && traceStart <= viewState.endTime

    // Check vertical visibility
    const y = timelineHeight + trace.depth * (barHeight + barPadding) + viewState.offsetY
    const isVisibleVertically = y + barHeight >= 0 && y <= canvasHeight

    return isVisibleHorizontally && isVisibleVertically
  })
}

// Utility function to get Y coordinate for a trace
export const getTraceYPosition = (
  trace: TraceEvent,
  viewState: ViewState,
  options: TraceViewerOptions = {}
): number => {
  const { barHeight = 30, barPadding = 4, timelineHeight = 25 } = options
  return timelineHeight + trace.depth * (barHeight + barPadding) + viewState.offsetY
}
