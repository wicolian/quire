import { useEffect, useRef } from 'preact/hooks'
import { Icon } from './Icon'

/**
 * The corner grip that resizes the panel.
 *
 * Figma gives a plugin window a fixed size and no chrome to drag, so a plugin that
 * wants to be resizable has to provide the handle and call figma.ui.resize itself.
 *
 * Resizing is driven live so the panel tracks the pointer, but the size is only
 * written to storage on release. Persisting every intermediate size would mean a
 * clientStorage write on every pointer move.
 */

export interface ResizeGripProps {
  onResize: (width: number, height: number) => void
  onCommit: (width: number, height: number) => void
}

export function ResizeGrip({ onResize, onCommit }: ResizeGripProps) {
  const active = useRef(false)
  const latest = useRef({ width: 0, height: 0 })

  useEffect(() => {
    function move(event: PointerEvent) {
      if (!active.current) return
      // Pointer position in the iframe is the panel size, since the panel origin is
      // the iframe origin. No offset bookkeeping needed.
      const width = Math.round(event.clientX + 2)
      const height = Math.round(event.clientY + 2)
      latest.current = { width, height }
      onResize(width, height)
    }

    function up() {
      if (!active.current) return
      active.current = false
      onCommit(latest.current.width, latest.current.height)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [onResize, onCommit])

  return (
    <div
      class="resize-grip"
      title="Drag to resize"
      onPointerDown={(event) => {
        active.current = true
        latest.current = { width: window.innerWidth, height: window.innerHeight }
        ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
      }}
    >
      <Icon name="resize" />
    </div>
  )
}
