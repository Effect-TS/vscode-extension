import type { VscodeContextMenu } from "@vscode-elements/elements"
import * as React from "react"
import { useOverlayPosition } from "react-aria"

interface ContextMenuState {
  ref: React.RefObject<any>
  open: () => void
}

export function useContextMenu(
  options: VscodeContextMenu["data"],
  onSelect: (value: string) => void
): ContextMenuState {
  const triggerRef = React.useRef<any>(null)
  const menuRef = React.useRef<VscodeContextMenu | null>(null)
  const optionsRef = React.useRef(options)
  const onSelectRef = React.useRef(onSelect)
  const [_, setClickedCount] = React.useState(0)

  // Keep refs updated
  React.useEffect(() => {
    optionsRef.current = options
    onSelectRef.current = onSelect
  }, [options, onSelect])

  // Use React Aria's overlay positioning
  const { overlayProps } = useOverlayPosition({
    targetRef: triggerRef,
    overlayRef: menuRef,
    placement: "bottom start",
    offset: 4,
    isOpen: true,
    shouldFlip: true,
    containerPadding: 8
  })

  const open = React.useCallback(() => {
    if (!triggerRef.current) {
      return
    }

    // If there's an existing menu, remove it first
    if (menuRef.current) {
      const wasOpen = menuRef.current.show
      menuRef.current.remove()
      menuRef.current = null
      if (wasOpen) return
    }

    // Create new menu element
    const menuElement = document.createElement(
      "vscode-context-menu"
    ) as VscodeContextMenu

    // Style it with absolute positioning
    menuElement.style.position = "absolute"
    menuElement.style.zIndex = "10000"

    // Store reference
    menuRef.current = menuElement

    // Append to body
    document.body.appendChild(menuElement)

    // Set menu data and show
    menuElement.data = optionsRef.current
    menuElement.show = true

    // Apply React Aria positioning
    requestAnimationFrame(() => {
      Object.assign(menuElement.style, overlayProps.style)
    })

    // Add event listener for selection
    const handleSelect = (event: any) => {
      if (onSelectRef.current) {
        onSelectRef.current(event.detail.value)
      }
      // Remove menu after selection
      if (menuRef.current) {
        menuRef.current.remove()
        menuRef.current = null
      }
    }

    menuElement.addEventListener("vsc-context-menu-select", handleSelect)
    setClickedCount((_) => _ + 1)
  }, [overlayProps])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (menuRef.current) {
        menuRef.current.remove()
        menuRef.current = null
      }
    }
  }, [])

  return { ref: triggerRef, open }
}
