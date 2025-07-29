import React, { useCallback, useEffect, useRef } from "react"
import type { TraceEvent, TraceViewerOptions, ViewState } from "./TraceViewerUtils"

interface TraceViewerProps {
  traces: ReadonlyArray<TraceEvent>
  viewState: ViewState
  timeOrigin: bigint
  onViewStateChange: (viewState: ViewState) => void
  options?: TraceViewerOptions
  onTraceClick?: (trace: TraceEvent) => void
  onTraceHover?: (trace: TraceEvent | null) => void
}

// Drawing functions outside of component

const drawTimeScale = (
  ctx: CanvasRenderingContext2D,
  width: number,
  viewState: ViewState,
  timelineHeight: number,
  offsetY: number,
  timeOrigin: bigint
) => {
  // Clear timeline area
  ctx.clearRect(0, offsetY, width, timelineHeight)

  // Calculate time range and pixels per nanosecond
  const visibleDuration = viewState.endTime - viewState.startTime
  const pixelsPerNano = width / Number(visibleDuration)
  const pixelsPerSecond = pixelsPerNano * 1_000_000_000

  // Draw continuous line
  ctx.strokeStyle = "#e0e0e0"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, offsetY + timelineHeight)
  ctx.lineTo(width, offsetY + timelineHeight)
  ctx.stroke()

  // Calculate appropriate time interval based on zoom level
  const minPixelsBetweenLabels = 50
  const secondsPerLabel = minPixelsBetweenLabels / pixelsPerSecond

  // Find a nice round interval
  let interval = 0.001
  const intervals = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600]
  for (const i of intervals) {
    if (i >= secondsPerLabel) {
      interval = i
      break
    }
  }

  // Draw time labels and ticks
  ctx.fillStyle = "#666"
  ctx.font = "10px Arial"
  const startTimeSeconds = Number(viewState.startTime) / 1_000_000_000
  const endTimeSeconds = Number(viewState.endTime) / 1_000_000_000

  // Start from a rounded time
  const firstTick = Math.ceil(startTimeSeconds / interval) * interval

  for (let time = firstTick; time <= endTimeSeconds; time += interval) {
    const realTime = time - Number(timeOrigin / 1_000_000_000n)
    const timeNanos = BigInt(Math.round(time * 1_000_000_000))
    const x = Number(timeNanos - viewState.startTime) * pixelsPerNano

    if (x >= -100 && x <= width + 100) {
      // Format label based on interval
      let label: string
      if (interval < 1) {
        label = `${realTime.toFixed(3)}s`
      } else if (interval < 60) {
        label = `${realTime.toFixed(0)}s`
      } else if (interval < 3600) {
        const minutes = Math.floor(realTime / 60)
        const seconds = realTime % 60
        label = seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`
      } else {
        const hours = Math.floor(realTime / 3600)
        const minutes = Math.floor((realTime % 3600) / 60)
        label = minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`
      }

      // Draw label above the line
      ctx.fillText(label, x + 2, offsetY + 12)

      // Draw tick
      ctx.strokeStyle = "#d0d0d0"
      ctx.beginPath()
      ctx.moveTo(x, offsetY + timelineHeight - 5)
      ctx.lineTo(x, offsetY + timelineHeight)
      ctx.stroke()
    }
  }
}

const drawTraceBar = (
  ctx: CanvasRenderingContext2D,
  trace: TraceEvent,
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number
) => {
  // Calculate visible bounds
  const visibleX = Math.max(0, x)
  const visibleWidth = Math.min(canvasWidth - visibleX, width - (visibleX - x))

  // Draw trace rectangle (only visible portion)
  ctx.fillStyle = trace.color
  ctx.fillRect(visibleX, y, visibleWidth, height)

  // Draw border (only visible portion)
  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)"
  ctx.lineWidth = 1
  ctx.strokeRect(visibleX, y, visibleWidth, height)

  // Draw text
  ctx.fillStyle = "#333"
  ctx.font = "11px Arial"
  const text = trace.name
  const textWidth = ctx.measureText(text).width

  // Calculate text position - always start from visible area
  const textX = visibleX + 5
  const availableWidth = visibleWidth - 10

  if (textWidth < availableWidth) {
    ctx.fillText(text, textX, y + height / 2 + 4)
  } else if (availableWidth > 20) {
    // Truncate text to fit visible area
    const ellipsis = "..."
    let truncatedText = text
    while (ctx.measureText(truncatedText + ellipsis).width > availableWidth && truncatedText.length > 0) {
      truncatedText = truncatedText.slice(0, -1)
    }
    if (truncatedText.length > 0) {
      ctx.fillText(truncatedText + ellipsis, textX, y + height / 2 + 4)
    }
  }

  // Draw duration (only if there's space and the end is visible)
  if (x + width <= canvasWidth) {
    // Convert nanoseconds to seconds for display
    const durationInSeconds = Number(trace.endTime - trace.startTime) / 1_000_000_000
    const durationText = `${durationInSeconds.toFixed(3)}s`
    const durationTextWidth = ctx.measureText(durationText).width
    const textEndX = textX + Math.min(textWidth, availableWidth)

    if (visibleWidth > durationTextWidth + (textEndX - visibleX) + 20) {
      ctx.fillStyle = "#666"
      ctx.font = "10px Arial"
      ctx.fillText(durationText, x + width - durationTextWidth - 5, y + height / 2 + 4)
    }
  }
}

const drawTraces = (
  ctx: CanvasRenderingContext2D,
  traces: ReadonlyArray<TraceEvent>,
  viewState: ViewState,
  canvasWidth: number,
  canvasHeight: number,
  barHeight: number,
  barPadding: number,
  offsetY: number
) => {
  const visibleDuration = viewState.endTime - viewState.startTime
  const pixelsPerNano = canvasWidth / Number(visibleDuration)

  traces.forEach((trace) => {
    // Calculate position based on the visible time range
    const x = Number(trace.startTime - viewState.startTime) * pixelsPerNano
    const y = offsetY + trace.depth * (barHeight + barPadding) + viewState.offsetY
    const width = Number(trace.endTime - trace.startTime) * pixelsPerNano

    // Skip if completely outside viewport horizontally
    if (x + width < 0 || x > canvasWidth) {
      return
    }

    // Skip if outside viewport vertically
    if (y + barHeight < 0 || y > canvasHeight) {
      return
    }

    drawTraceBar(ctx, trace, x, y, width, barHeight, canvasWidth)
  })
}

const TraceViewer: React.FC<TraceViewerProps> = ({
  traces,
  viewState,
  timeOrigin,
  onViewStateChange,
  options = {},
  onTraceClick,
  onTraceHover
}) => {
  const {
    barHeight = 30,
    barPadding = 4,
    timelineHeight = 25
  } = options
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const hoveredTraceRef = useRef<TraceEvent | null>(null)

  const getTraceAtPosition = useCallback((x: number, y: number): TraceEvent | null => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const visibleDuration = viewState.endTime - viewState.startTime
    const pixelsPerNano = canvas.width / Number(visibleDuration)

    // Check if click is in the trace area (below timeline)
    if (y < timelineHeight) return null

    // Find which trace was clicked
    for (const trace of traces) {
      const traceX = Number(trace.startTime - viewState.startTime) * pixelsPerNano
      const traceY = timelineHeight + trace.depth * (barHeight + barPadding) + viewState.offsetY
      const traceWidth = Number(trace.endTime - trace.startTime) * pixelsPerNano

      if (
        x >= traceX && x <= traceX + traceWidth &&
        y >= traceY && y <= traceY + barHeight
      ) {
        return trace
      }
    }

    return null
  }, [traces, viewState, barHeight, barPadding, timelineHeight])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw traces first (they are the spans)
    drawTraces(
      ctx,
      traces,
      viewState,
      canvas.width,
      canvas.height,
      barHeight,
      barPadding,
      timelineHeight
    )

    // Draw time scale on top
    drawTimeScale(ctx, canvas.width, viewState, timelineHeight, 0, timeOrigin)
  }, [traces, viewState, barHeight, barPadding, timelineHeight, timeOrigin])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      draw()
    }

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left

      // Calculate the time under the mouse cursor
      const visibleDuration = viewState.endTime - viewState.startTime
      const pixelsPerNano = canvas.width / Number(visibleDuration)
      const timeUnderMouse = viewState.startTime + BigInt(Math.round(mouseX / pixelsPerNano))

      // Calculate zoom factor
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9

      // Calculate new time range, keeping the time under mouse at the same position
      const leftDuration = timeUnderMouse - viewState.startTime
      const rightDuration = viewState.endTime - timeUnderMouse

      const newLeftDuration = BigInt(Math.round(Number(leftDuration) * zoomFactor))
      const newRightDuration = BigInt(Math.round(Number(rightDuration) * zoomFactor))

      const newStartTime = timeUnderMouse - newLeftDuration
      const newEndTime = timeUnderMouse + newRightDuration

      onViewStateChange({
        startTime: newStartTime,
        endTime: newEndTime,
        offsetY: viewState.offsetY
      })
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    canvas.addEventListener("wheel", handleWheel, { passive: false })

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      canvas.removeEventListener("wheel", handleWheel)
    }
  }, [draw, viewState, onViewStateChange])

  useEffect(() => {
    draw()
  }, [draw])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const clickedTrace = getTraceAtPosition(x, y)
    if (clickedTrace && onTraceClick) {
      onTraceClick(clickedTrace)
    } else {
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY - viewState.offsetY
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (isDraggingRef.current) {
      // Calculate how much to pan in time units
      const visibleDuration = viewState.endTime - viewState.startTime
      const pixelsPerNano = canvas.width / Number(visibleDuration)
      const deltaX = dragStartRef.current.x - e.clientX
      const deltaTimeNanos = BigInt(Math.round(deltaX / pixelsPerNano))

      onViewStateChange({
        startTime: viewState.startTime + deltaTimeNanos,
        endTime: viewState.endTime + deltaTimeNanos,
        offsetY: Math.min(0, e.clientY - dragStartRef.current.y)
      })

      dragStartRef.current.x = e.clientX
    } else if (onTraceHover) {
      const hoveredTrace = getTraceAtPosition(x, y)
      if (hoveredTrace !== hoveredTraceRef.current) {
        hoveredTraceRef.current = hoveredTrace
        onTraceHover(hoveredTrace)

        // Update cursor
        if (canvasRef.current) {
          canvasRef.current.style.cursor = hoveredTrace ? "pointer" : "grab"
        }
      }
    }
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  const handleMouseLeave = () => {
    isDraggingRef.current = false
    if (onTraceHover && hoveredTraceRef.current) {
      hoveredTraceRef.current = null
      onTraceHover(null)
    }
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grab"
    }
  }

  const canvasStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    cursor: "grab",
    display: "block"
  }

  return (
    <canvas
      ref={canvasRef}
      style={canvasStyle}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  )
}

export default TraceViewer
