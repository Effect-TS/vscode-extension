import * as DevToolsDomain from "@effect/experimental/DevTools/Domain"
import React from "react"

interface TraceInfoPanelProps {
  trace?: DevToolsDomain.ParentSpan | undefined
  timeOrigin: bigint
  onGoToLocation: () => void
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

function formatDuration(duration: bigint) {
  const durationMs = Number(duration) / 1_000_000
  const durationSec = durationMs / 1000
  return durationSec >= 1
    ? `${durationSec.toFixed(3)} s`
    : `${durationMs.toFixed(3)} ms`
}

const TraceInfoPanel: React.FC<TraceInfoPanelProps> = ({ trace, timeOrigin, onGoToLocation }) => {
  if (!trace) {
    return (
      <div style={panelStyle}>
        <p style={{ color: styles.textColor, textAlign: "center", marginTop: "20px" }}>
          Click on a span to see details
        </p>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0, marginBottom: styles.headerMarginBottom }}>Span Details</h3>

      <div style={fieldStyle}>
        <strong>Span ID</strong>
        <div style={{ ...valueStyle, fontFamily: "monospace", fontSize: styles.monospaceFontSize }}>{trace.spanId}</div>
      </div>

      {trace._tag === "Span" ?
        (
          <div style={fieldStyle}>
            <strong>Name</strong>
            <div style={{ ...valueStyle, wordBreak: "break-word" }}>{trace.name}</div>
          </div>
        ) :
        null}

      {trace._tag === "Span" && trace.status._tag === "Ended" ?
        (
          <div style={fieldStyle}>
            <strong>Duration</strong>
            <div style={valueStyle}>
              {formatDuration(trace.status.endTime - trace.status.startTime)}
            </div>
          </div>
        ) :
        null}

      {trace._tag === "Span" ?
        (
          <div style={fieldStyle}>
            <strong>Start Time</strong>
            <div style={valueStyle}>{formatDuration(trace.status.startTime - timeOrigin)}</div>
          </div>
        ) :
        null}

      {trace._tag === "Span" && trace.status._tag === "Ended" ?
        (
          <div style={fieldStyle}>
            <strong>End Time</strong>
            <div style={valueStyle}>{formatDuration(trace.status.endTime - timeOrigin)}</div>
          </div>
        ) :
        null}

      {trace._tag === "Span" ?
        Array.from(trace.attributes.entries()).map(([name, value]) => (
          <div style={fieldStyle} key={name}>
            <strong>
              {name === "@effect/devtools/trace"
                ? "Location"
                : String(name)}
            </strong>
            <div style={valueStyle}>
              {name === "@effect/devtools/trace"
                ? <a href="#" onClick={onGoToLocation}>Go to location</a>
                : String(value)}
            </div>
          </div>
        )) :
        null}
    </div>
  )
}

export default TraceInfoPanel
