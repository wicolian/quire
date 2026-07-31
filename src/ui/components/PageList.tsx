import { useEffect, useRef, useState } from 'preact/hooks'
import type { PageRef } from '../../core/types'

/**
 * The spine.
 *
 * A hairline binds the pages down the left edge. Dropping a break severs it, so
 * "these become separate PDFs" is something you see rather than something you read.
 * During export the spine fills with ink from the top, page by page, which makes the
 * progress indicator and the structure the same mark.
 */

const ROW_HEIGHT = 30

export interface PageListProps {
  pages: PageRef[]
  excluded: Set<string>
  breaks: Set<string>
  newPageIds: Set<string>
  /** How many pages have been pressed so far, for the ink fill. */
  pressedCount: number
  busy: boolean
  onReorder: (from: number, to: number) => void
  onToggleExcluded: (pageId: string) => void
  onToggleBreak: (pageId: string) => void
  onReveal: (pageId: string) => void
}

interface DragState {
  index: number
  pointerY: number
  startY: number
}

export function PageList(props: PageListProps) {
  const { pages, excluded, breaks, newPageIds } = props
  const [drag, setDrag] = useState<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  /**
   * Pointer-based reordering rather than HTML5 drag-and-drop, which behaves
   * inconsistently inside a plugin iframe and cannot show a precise insertion point.
   */
  useEffect(() => {
    if (!drag) return

    const move = (event: PointerEvent) => {
      setDrag((current) => (current ? { ...current, pointerY: event.clientY } : current))
    }

    const up = () => {
      setDrag((current) => {
        if (current) {
          const target = targetIndex(current, pages.length)
          if (target !== current.index && target !== current.index + 1) {
            props.onReorder(current.index, target > current.index ? target - 1 : target)
          }
        }
        return null
      })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, pages.length, props.onReorder])

  function targetIndex(state: DragState, count: number): number {
    const delta = state.pointerY - state.startY
    const shifted = state.index + Math.round(delta / ROW_HEIGHT)
    return Math.max(0, Math.min(count, shifted))
  }

  const insertionIndex = drag ? targetIndex(drag, pages.length) : null

  return (
    <div class="sheet" ref={containerRef}>
      {pages.map((page, index) => {
        const isBreak = index > 0 && breaks.has(page.id)
        const isLastInGroup =
          index === pages.length - 1 || (breaks.has(pages[index + 1]?.id ?? '') && index + 1 < pages.length)

        return (
          <div key={page.id}>
            {insertionIndex === index && <div class="insertion" />}

            {isBreak && (
              <div class="break">
                <div class="break-mark" aria-hidden="true">
                  ✂
                </div>
                <div class="break-rule" />
                <div class="break-label mono">NEW FILE</div>
              </div>
            )}

            <div
              class={[
                'row',
                excluded.has(page.id) ? 'excluded' : '',
                isLastInGroup ? 'last-in-group' : '',
                drag?.index === index ? 'dragging' : '',
                index < props.pressedCount ? 'pressed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div
                class="spine"
                onPointerDown={(event) => {
                  if (props.busy) return
                  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
                  setDrag({ index, pointerY: event.clientY, startY: event.clientY })
                }}
                title="Drag to reorder"
              >
                <span class="spine-grip" aria-hidden="true">
                  ⣿
                </span>
              </div>

              <div class="page-num">{index + 1}</div>

              <div
                class="page-name"
                onClick={() => props.onReveal(page.id)}
                title={`${page.name} — ${Math.round(page.width)}×${Math.round(page.height)}`}
              >
                {page.name}
              </div>

              <div class="row-actions">
                {newPageIds.has(page.id) && <span class="badge">● new</span>}
                <button
                  class="row-action"
                  onClick={() => props.onToggleBreak(page.id)}
                  disabled={index === 0 || props.busy}
                  title={breaks.has(page.id) ? 'Remove split' : 'Split into a new file here'}
                  aria-pressed={breaks.has(page.id)}
                >
                  ✂
                </button>
                <button
                  class="row-action"
                  onClick={() => props.onToggleExcluded(page.id)}
                  disabled={props.busy}
                  title={excluded.has(page.id) ? 'Include this page' : 'Leave this page out'}
                  aria-pressed={excluded.has(page.id)}
                >
                  {excluded.has(page.id) ? '＋' : '−'}
                </button>
              </div>
            </div>
          </div>
        )
      })}

      {insertionIndex === pages.length && <div class="insertion" />}
    </div>
  )
}
