import { useCallback, useState } from "react"
import TraceLabels from "./components/TraceLabels"
import TraceMinimap from "./components/TraceMinimap"
import TraceViewer from "./components/TraceViewer"
import type { TraceEvent, TraceViewerOptions, ViewState } from "./components/TraceViewerUtils"
import "./App.css"
import { useRxSuspenseSuccess } from "@effect-rx/rx-react"
import { timeOriginRx, traceEventsRx } from "./RxStore"

function App() {
  const { value: traces } = useRxSuspenseSuccess(traceEventsRx)
  const { value: timeOrigin } = useRxSuspenseSuccess(timeOriginRx)

  // Initialize view to show the first 2 seconds of the trace
  const [viewState, setViewState] = useState<ViewState>({
    startTime: timeOrigin,
    endTime: timeOrigin + 60_000_000_000n, // 60 seconds in nanoseconds
    offsetY: 0
  })

  // cap the max time range to 1 hour
  const changeViewState = useCallback((viewState: ViewState) => {
    if (viewState.endTime - viewState.startTime < 3600n * 1_000_000_000n) {
      setViewState(viewState)
    }
  }, [setViewState])

  const options: TraceViewerOptions = {
    barHeight: 18,
    barPadding: 4,
    timelineHeight: 16
  }

  const handleTraceClick = (trace: TraceEvent) => {
    console.log("Trace clicked:", trace)
  }

  const handleTraceHover = (trace: TraceEvent | null) => {
    if (trace) {
      console.log("Hovering over trace:", trace)
    } else {
      console.log("No longer hovering over any trace")
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ height: "80px", borderBottom: "1px solid #e0e0e0" }}>
        <TraceMinimap
          traces={traces}
          viewState={viewState}
          onViewStateChange={changeViewState}
          height={80}
          barHeight={options.barHeight || 18}
          barPadding={options.barPadding || 4}
        />
      </div>
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: "250px", borderRight: "1px solid #e0e0e0" }}>
          <TraceLabels
            traces={traces}
            viewState={viewState}
            options={options}
            width={250}
          />
        </div>
        <div style={{ flex: 1 }}>
          <TraceViewer
            traces={traces}
            viewState={viewState}
            timeOrigin={timeOrigin}
            onViewStateChange={changeViewState}
            options={options}
            onTraceClick={handleTraceClick}
            onTraceHover={handleTraceHover}
          />
        </div>
      </div>
    </div>
  )
}

export default App
