import { useEffect, useRef, useState } from 'preact/hooks'
import type { PageRef } from '../../core/types'
import { Icon } from './Icon'

/**
 * The spine.
 *
 * A hairline binds the pages down the left edge. Dropping a break severs it, so
 * "these become separate PDFs" is something you see rather than something you read.
 * During export the spine fills with ink from the top, page by page, which makes the
 * progress indicator and the structure the same mark.
 */

/** Must track `--row` in styles.css; drag target index is computed from it. */
const ROW_HEIGHT = 34

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

  /**
   * How far a row slides to open a gap for the one being dragged.
   *
   * Rows between the sheet's origin and its destination shift by exactly one row to
   * close up behind it, which is what makes the drop position feel physical rather
   * than announced by a floating line.
   *
   * Uses ROW_HEIGHT rather than measured offsets, so a drag crossing a break marker
   * displaces by slightly less than the real distance. The drop index has always been
   * computed the same way, so this stays consistent with where the row actually lands.
   */
  function displacement(index: number): string | undefined {
    if (!drag || insertionIndex === null || index === drag.index) return undefined
    if (index > drag.index && index < insertionIndex) return `translateY(${-ROW_HEIGHT}px)`
    if (index >= insertionIndex && index < drag.index) return `translateY(${ROW_HEIGHT}px)`
    return undefined
  }

  return (
    <div class={`sheet${drag ? ' dragging' : ''}`} ref={containerRef}>
      {pages.map((page, index) => {
        const isBreak = index > 0 && breaks.has(page.id)
        // Group boundaries cap the spine. A group starts at the first page or at any
        // break, and ends at the last page or immediately before the next break.
        const isFirstInGroup = index === 0 || isBreak
        const isLastInGroup =
          index === pages.length - 1 || breaks.has(pages[index + 1]?.id ?? '')

        return (
          <div
            key={page.id}
            class="row-shell"
            style={{
              transform: displacement(index),
              // Micro cascade, capped so a long document does not stagger for a second
              // before it is readable.
              animationDelay: `${Math.min(index, 12) * 22}ms`,
            }}
          >
            {insertionIndex === index && <div class="insertion" />}

            {isBreak && (
              <div class="break">
                <div class="break-mark">
                  <Icon name="cut" size={0.85} />
                </div>
                <div class="break-rule" />
                <div class="break-label mono">NEW FILE</div>
              </div>
            )}

            <div
              class={[
                'row',
                excluded.has(page.id) ? 'excluded' : '',
                isFirstInGroup ? 'first-in-group' : '',
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
                <span class="spine-grip">
                  <Icon name="grip" size={0.95} />
                </span>
              </div>

              {/* Zero-padded so the column holds its width past page 9 and the names
                  stay on one left edge. */}
              <div class="page-num">{String(index + 1).padStart(2, '0')}</div>

              <div
                class="page-name"
                onClick={() => props.onReveal(page.id)}
                title={`${page.name} (${Math.round(page.width)}x${Math.round(page.height)})`}
              >
                {page.name}
              </div>

              <div class="row-actions">
                {newPageIds.has(page.id) && <span class="badge">NEW</span>}
                <button
                  class="row-action"
                  onClick={() => props.onToggleBreak(page.id)}
                  disabled={index === 0 || props.busy}
                  title={breaks.has(page.id) ? 'Remove split' : 'Split into a new file here'}
                  aria-pressed={breaks.has(page.id)}
                >
                  <Icon name="cut" title="Split here" />
                </button>
                <button
                  class="row-action"
                  onClick={() => props.onToggleExcluded(page.id)}
                  disabled={props.busy}
                  title={excluded.has(page.id) ? 'Include this page' : 'Leave this page out'}
                  aria-pressed={excluded.has(page.id)}
                >
                  <Icon
                    name={excluded.has(page.id) ? 'include' : 'exclude'}
                    title={excluded.has(page.id) ? 'Include' : 'Leave out'}
                  />
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
