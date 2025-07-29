import React, { useCallback, useEffect, useRef } from "react"
import type { TraceEvent, ViewState } from "./TraceViewerUtils"

interface MinimapProps {
  traces: ReadonlyArray<TraceEvent>
  viewState: ViewState
  onViewStateChange: (viewState: ViewState) => void
  height: number
  barHeight: number
  barPadding: number
}

const TraceMinimap: React.FC<MinimapProps> = ({
  traces,
  viewState,
  onViewStateChange,
  height,
  barHeight,
  barPadding
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDraggingRef = useRef(false)
  const fullTimeRangeRef = useRef<{ start: bigint; end: bigint } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || traces.length === 0 || height === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Calculate full time range
    const startTimes = traces.map((t) => t.startTime)
    const endTimes = traces.map((t) => t.endTime)
    const fullTimeRange = {
      start: startTimes.reduce((min, t) => t < min ? t : min),
      end: endTimes.reduce((max, t) => t > max ? t : max)
    }
    fullTimeRangeRef.current = fullTimeRange

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, height)

    const totalDuration = fullTimeRange.end - fullTimeRange.start
    const pixelsPerNano = canvas.width / Number(totalDuration)

    // Find max depth for scaling
    const maxDepth = Math.max(...traces.map((t) => t.depth)) + 1
    const minimapBarHeight = Math.min(Math.max(1, height / maxDepth), height / 10)

    // Draw all traces in minimap
    traces.forEach((trace) => {
      const x = Number(trace.startTime - fullTimeRange.start) * pixelsPerNano
      const y = maxDepth === 0 ? 0 : (trace.depth / maxDepth) * height
      const width = Math.max(1, Number(trace.endTime - trace.startTime) * pixelsPerNano)

      // Check if trace is within current view
      const traceStart = trace.startTime
      const traceEnd = trace.endTime
      const isInView = traceEnd >= viewState.startTime && traceStart <= viewState.endTime

      // Set transparency based on whether trace is in view
      ctx.globalAlpha = isInView ? 0.8 : 0.3
      ctx.fillStyle = trace.color
      ctx.fillRect(x, y, width, minimapBarHeight)
    })

    // Draw current view rectangle with vertical offset indicator
    ctx.globalAlpha = 1
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 2
    const viewX = Number(viewState.startTime - fullTimeRange.start) * pixelsPerNano
    const viewWidth = Number(viewState.endTime - viewState.startTime) * pixelsPerNano

    // Calculate vertical view range
    const maxDepthPixels = maxDepth * (barHeight + barPadding)
    const viewportHeight = window.innerHeight - height - 25 - 100 // Approximate visible area height
    const verticalScale = height / maxDepthPixels

    // Calculate vertical view position and height in minimap
    const viewY = -viewState.offsetY * verticalScale
    const viewHeight = Math.min(height, viewportHeight * verticalScale)

    // Draw horizontal time range
    ctx.strokeRect(viewX, 0, viewWidth, height)

    // Draw vertical range indicator if there's vertical scrolling
    if (maxDepthPixels > viewportHeight) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.1)"
      ctx.fillRect(viewX, viewY, viewWidth, viewHeight)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"
      ctx.strokeRect(viewX, viewY, viewWidth, viewHeight)
    }

    // Reset line width
    ctx.lineWidth = 1
  }, [traces, viewState, height, barHeight, barPadding])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = height
      draw()
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    return () => {
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [draw, height])

  useEffect(() => {
    draw()
  }, [draw])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    isDraggingRef.current = true

    // Update view immediately on minimap click
    if (fullTimeRangeRef.current && traces.length > 0) {
      const totalDuration = fullTimeRangeRef.current.end - fullTimeRangeRef.current.start
      const currentViewDuration = viewState.endTime - viewState.startTime

      // Center the view on the clicked position
      const clickTime = fullTimeRangeRef.current.start + BigInt(Math.round(Number(totalDuration) * (x / rect.width)))
      const newStartTime = clickTime - currentViewDuration / 2n
      const newEndTime = clickTime + currentViewDuration / 2n

      // Calculate Y offset based on click position
      const maxDepth = Math.max(...traces.map((t) => t.depth)) + 1
      const maxDepthPixels = maxDepth * (barHeight + barPadding)
      const verticalScale = height / maxDepthPixels
      
      // Calculate the maximum allowed offset (same logic as TraceViewer)
      const viewportHeight = window.innerHeight - height - 25 - 100 // Approximate visible area height
      const lowestTraceY = 25 + (maxDepth - 1) * (barHeight + barPadding) // 25 is timelineHeight
      const maxOffsetY = Math.max(0, lowestTraceY + barHeight - viewportHeight)
      
      // Convert click Y to offset
      const clickOffsetY = -(y / verticalScale)
      const limitedOffsetY = Math.max(-maxOffsetY, Math.min(0, clickOffsetY))

      onViewStateChange({
        startTime: newStartTime,
        endTime: newEndTime,
        offsetY: limitedOffsetY
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !fullTimeRangeRef.current || traces.length === 0) return

    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Handle minimap dragging
    const mouseX = Math.max(0, Math.min(rect.width, x))
    const mouseY = Math.max(0, Math.min(rect.height, y))
    const totalDuration = fullTimeRangeRef.current.end - fullTimeRangeRef.current.start
    const currentViewDuration = viewState.endTime - viewState.startTime

    // Center the view on the mouse position
    const mouseTime = fullTimeRangeRef.current.start + BigInt(Math.round(Number(totalDuration) * (mouseX / rect.width)))
    const newStartTime = mouseTime - currentViewDuration / 2n
    const newEndTime = mouseTime + currentViewDuration / 2n

    // Calculate Y offset based on mouse position
    const maxDepth = Math.max(...traces.map((t) => t.depth)) + 1
    const maxDepthPixels = maxDepth * (barHeight + barPadding)
    const verticalScale = height / maxDepthPixels
    
    // Calculate the maximum allowed offset (same logic as TraceViewer)
    const viewportHeight = window.innerHeight - height - 25 - 100 // Approximate visible area height
    const lowestTraceY = 25 + (maxDepth - 1) * (barHeight + barPadding) // 25 is timelineHeight
    const maxOffsetY = Math.max(0, lowestTraceY + barHeight - viewportHeight)
    
    // Convert mouse Y to offset
    const mouseOffsetY = -(mouseY / verticalScale)
    const limitedOffsetY = Math.max(-maxOffsetY, Math.min(0, mouseOffsetY))

    onViewStateChange({
      startTime: newStartTime,
      endTime: newEndTime,
      offsetY: limitedOffsetY
    })
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  const handleMouseLeave = () => {
    isDraggingRef.current = false
  }

  if (height === 0) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: `${height}px`,
        cursor: "pointer",
        display: "block"
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  )
}

export default TraceMinimap
