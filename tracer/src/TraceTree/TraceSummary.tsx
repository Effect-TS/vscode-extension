import { useMemo } from "react"
import { Duration, Option } from "effect"
import { formatDuration, getTotalSpans } from "../lib/utils"
import { CircleHelp } from "lucide-react"
import { useActiveSpan } from "@/SpanRoots/context"

export function TraceSummary() {
  const selectedSpan = useActiveSpan()
  const summary = useMemo(() => {
    if (selectedSpan !== undefined) {
      let summary = `${getTotalSpans(selectedSpan)} spans`
      if (Option.isSome(selectedSpan.startTime)) {
        const startTime = Duration.toMillis(selectedSpan.startTime.value)
        const date = new Date(startTime).toString()
        summary += ` at ${date}`
      }
      if (Option.isSome(selectedSpan.duration)) {
        const duration = formatDuration(selectedSpan.duration.value)
        summary += ` (${duration})`
      }
      return summary
    }
    return ""
  }, [selectedSpan])

  return (
    <p className="ml-px py-3">
      <span className="flex items-center text-sm text-[--sl-color-text]">
        <span className="mr-2 text-[--sl-color-white] font-bold">Summary</span>
        <span className="mr-2">
          <CircleHelp className="w-3" />
        </span>
        <span>{summary}</span>
      </span>
    </p>
  )
}
