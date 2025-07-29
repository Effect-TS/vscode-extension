import React from "react"
import type { TraceEvent } from "./TraceViewerUtils"

interface TraceInfoPanelProps {
  trace: TraceEvent | null
  timeOrigin: bigint
}

// Common style constants
const styles = {
  padding: "16px",
  borderColor: "#e0e0e0",
  textColor: "#666",
  itemMarginBottom: "12px",
  valueMarginTop: "4px",
  monospaceFontSize: "12px",
  headerMarginBottom: "16px"
}

const panelStyle: React.CSSProperties = {
  padding: styles.padding,
  height: "100%",
  borderLeft: `1px solid ${styles.borderColor}`,
  boxSizing: "border-box",
  overflowY: "auto"
}

const fieldStyle: React.CSSProperties = {
  marginBottom: styles.itemMarginBottom
}

const valueStyle: React.CSSProperties = {
  marginTop: styles.valueMarginTop
}

const TraceInfoPanel: React.FC<TraceInfoPanelProps> = ({ trace, timeOrigin }) => {
  if (!trace) {
    return (
      <div style={panelStyle}>
        <p style={{ color: styles.textColor, textAlign: "center", marginTop: "20px" }}>
          Click on a span to see details
        </p>
      </div>
    )
  }

  const duration = trace.endTime - trace.startTime
  const durationMs = Number(duration) / 1_000_000
  const durationSec = durationMs / 1000

  const startTimeRelative = Number(trace.startTime - timeOrigin) / 1_000_000_000
  const endTimeRelative = Number(trace.endTime - timeOrigin) / 1_000_000_000

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0, marginBottom: styles.headerMarginBottom }}>Span Details</h3>

      <div style={fieldStyle}>
        <strong>Name:</strong>
        <div style={{ ...valueStyle, wordBreak: "break-word" }}>{trace.name}</div>
      </div>

      <div style={fieldStyle}>
        <strong>ID:</strong>
        <div style={{ ...valueStyle, fontFamily: "monospace", fontSize: styles.monospaceFontSize }}>{trace.id}</div>
      </div>

      <div style={fieldStyle}>
        <strong>Duration:</strong>
        <div style={valueStyle}>
          {durationSec >= 1
            ? `${durationSec.toFixed(3)} s`
            : `${durationMs.toFixed(3)} ms`}
        </div>
      </div>

      <div style={fieldStyle}>
        <strong>Start Time:</strong>
        <div style={valueStyle}>{startTimeRelative.toFixed(6)} s</div>
      </div>

      <div style={fieldStyle}>
        <strong>End Time:</strong>
        <div style={valueStyle}>{endTimeRelative.toFixed(6)} s</div>
      </div>
    </div>
  )
}

export default TraceInfoPanel
