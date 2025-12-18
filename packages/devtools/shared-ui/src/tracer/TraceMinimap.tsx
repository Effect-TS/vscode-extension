import * as React from "react"
import { useCallback, useEffect, useRef } from "react"

export interface MinimapBar {
  startTime: bigint
  endTime: bigint
  color: string
}

export interface ViewState {
  startTime: bigint // Start time of visible range in nanoseconds
  endTime: bigint // End time of visible range in nanoseconds
}

export interface MinimapOptions {
  minimapHeight?: number
}

interface MinimapProps {
  bars: ReadonlyArray<MinimapBar>
  startTime: bigint
  endTime: bigint
  viewState: ViewState
  onViewStateChange: (viewState: ViewState) => void
  options?: MinimapOptions
}

const TraceMinimap: React.FC<MinimapProps> = ({
  bars,
  endTime,
  onViewStateChange,
  options = {},
  startTime,
  viewState
}) => {
  const { minimapHeight = 80 } = options
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDraggingRef = useRef(false)
  const fullTimeRangeRef = useRef<{ start: bigint; end: bigint } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || minimapHeight === 0) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Use provided time range
    const fullTimeRange = {
      start: startTime,
      end: endTime
    }
    fullTimeRangeRef.current = fullTimeRange

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, minimapHeight)

    const totalDuration = fullTimeRange.end - fullTimeRange.start
    const pixelsPerNano = canvas.width / Number(totalDuration)

    // Each bar gets at least 1 pixel height, bars can overlap
    const barHeight = Math.max(1, minimapHeight / bars.length)

    // Draw all bars in minimap
    bars.forEach((bar, index) => {
      const x = Number(bar.startTime - fullTimeRange.start) * pixelsPerNano
      const y = (minimapHeight * index) / bars.length
      const width = Math.max(
        1,
        Number(bar.endTime - bar.startTime) * pixelsPerNano
      )
      // Use minimum 1 pixel height for each bar
      const height = Math.max(1, barHeight)

      // Check if bar is within current view
      const barStart = bar.startTime
      const barEnd = bar.endTime
      const isInView = barEnd >= viewState.startTime && barStart <= viewState.endTime

      // Set transparency based on whether bar is in view
      ctx.globalAlpha = isInView ? 0.8 : 0.3
      ctx.fillStyle = bar.color
      ctx.fillRect(x, y, width, height)
    })

    // Draw current view rectangle
    ctx.globalAlpha = 1
    ctx.strokeStyle = "#ffffff"
    ctx.lineWidth = 2
    const viewX = Number(viewState.startTime - fullTimeRange.start) * pixelsPerNano
    const viewWidth = Number(viewState.endTime - viewState.startTime) * pixelsPerNano

    // Draw horizontal time range
    ctx.strokeRect(viewX, 0, viewWidth, minimapHeight)

    // Reset line width
    ctx.lineWidth = 1
  }, [bars, startTime, endTime, viewState, minimapHeight])

  // Emit unchanged view event on mount to ensure current view range is communicated
  useEffect(() => {
    onViewStateChange(viewState)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = minimapHeight
      draw()
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    return () => {
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [draw, minimapHeight])

  useEffect(() => {
    draw()
  }, [draw])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left

    isDraggingRef.current = true

    // Update view immediately on minimap click
    if (fullTimeRangeRef.current) {
      const totalDuration = fullTimeRangeRef.current.end - fullTimeRangeRef.current.start
      const currentViewDuration = viewState.endTime - viewState.startTime

      // Center the view on the clicked position
      const clickTime = fullTimeRangeRef.current.start +
        BigInt(Math.round(Number(totalDuration) * (x / rect.width)))
      const newStartTime = clickTime - currentViewDuration / 2n
      const newEndTime = clickTime + currentViewDuration / 2n

      onViewStateChange({
        startTime: newStartTime,
        endTime: newEndTime
      })
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current || !fullTimeRangeRef.current) {
      return
    }

    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left

    // Handle minimap dragging
    const mouseX = Math.max(0, Math.min(rect.width, x))
    const totalDuration = fullTimeRangeRef.current.end - fullTimeRangeRef.current.start
    const currentViewDuration = viewState.endTime - viewState.startTime

    // Center the view on the mouse position
    const mouseTime = fullTimeRangeRef.current.start +
      BigInt(Math.round(Number(totalDuration) * (mouseX / rect.width)))
    const newStartTime = mouseTime - currentViewDuration / 2n
    const newEndTime = mouseTime + currentViewDuration / 2n

    onViewStateChange({
      startTime: newStartTime,
      endTime: newEndTime
    })
  }

  const handleMouseUp = () => {
    isDraggingRef.current = false
  }

  const handleMouseLeave = () => {
    isDraggingRef.current = false
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()

    if (!fullTimeRangeRef.current) return

    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left

    // Calculate the time position under the mouse
    const totalDuration = fullTimeRangeRef.current.end - fullTimeRangeRef.current.start
    const mouseTime = fullTimeRangeRef.current.start +
      BigInt(Math.round(Number(totalDuration) * (x / rect.width)))

    // Current view duration
    const currentViewDuration = viewState.endTime - viewState.startTime

    // Zoom factor: positive deltaY = zoom out, negative = zoom in
    // Use a smooth zoom factor (e.g., 10% per scroll notch)
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9
    const newViewDuration = BigInt(
      Math.round(Number(currentViewDuration) * zoomFactor)
    )

    // Calculate how far the mouse is within the current view (0 to 1)
    const mouseOffsetInView = Number(mouseTime - viewState.startTime) / Number(currentViewDuration)

    // Calculate new start and end times, keeping the mouse position fixed
    const newStartTime = mouseTime -
      BigInt(Math.round(Number(newViewDuration) * mouseOffsetInView))
    const newEndTime = newStartTime + newViewDuration

    onViewStateChange({
      startTime: newStartTime,
      endTime: newEndTime
    })
  }

  if (minimapHeight === 0) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: `${minimapHeight}px`,
        cursor: "pointer",
        display: "block"
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  )
}

export default TraceMinimap
