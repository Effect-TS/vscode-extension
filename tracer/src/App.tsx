import { VsCodeDropdown, VsCodeOption } from "./UiToolkit"
import { useRx, useRxSuspenseSuccess } from "@effect-rx/rx-react"
import { selectedSpanRx, spanRootsRx } from "./SpanRoots"
import { ActiveSpanContext } from "./SpanRoots/context"
import { TraceSummary } from "./TraceTree/TraceSummary"
import { TraceWaterfall } from "./TraceTree/TraceWaterfall"

export default function App() {
  const roots = useRxSuspenseSuccess(spanRootsRx).value
  const [selectedSpan, setSelectedSpan] = useRx(selectedSpanRx)
  const activeSpan = roots[selectedSpan]

  console.log({ activeSpan })

  return (
    <div className="p-2">
      <div className="dropdown-container">
        <label htmlFor="traceid">Trace ID:</label>

        <VsCodeDropdown id="traceid" value={String(selectedSpan)}>
          {roots.map((span, index) => (
            <VsCodeOption
              key={index}
              value={String(index)}
              label="Trace ID"
              onClick={() => setSelectedSpan(index)}
            >
              {span.traceId}
            </VsCodeOption>
          ))}
        </VsCodeDropdown>
      </div>

      {activeSpan && (
        <ActiveSpanContext.Provider value={activeSpan}>
          <TraceSummary />
          <TraceWaterfall />
        </ActiveSpanContext.Provider>
      )}
    </div>
  )
}
