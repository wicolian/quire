/**
 * What the panel says when there is nothing to export.
 *
 * Two distinct cases, because they need two different answers: nothing selected at
 * all, versus a section selected that has no frames at its top level. Collapsing them
 * into one generic "nothing to show" would leave the second case looking broken.
 */

export interface EmptyStateProps {
  reason: 'no-selection' | 'empty-section'
  sectionName?: string
  scanning: boolean
  scanProgress: { done: number; total: number } | null
  onScan: () => void
}

export function EmptyState({ reason, sectionName, scanning, scanProgress, onScan }: EmptyStateProps) {
  return (
    <div class="empty">
      <div class="empty-mark" aria-hidden="true">
        <SpineMark />
      </div>

      {reason === 'no-selection' ? (
        <>
          <div class="empty-title">Select a section on the canvas.</div>
          <div class="empty-hint">
            The frames inside it become the pages of your PDF. A loose selection of frames works
            too.
          </div>
        </>
      ) : (
        <>
          <div class="empty-title">
            "{sectionName}" has no frames at its top level.
          </div>
          <div class="empty-hint">
            Quire uses the frames directly inside a section as pages. Frames nested deeper are
            treated as page content.
          </div>
        </>
      )}

      {scanning ? (
        <div class="progress-line">
          Scanning file… {scanProgress ? `${scanProgress.done}/${scanProgress.total}` : ''}
        </div>
      ) : (
        <button class="link" onClick={onScan}>
          Scan whole file for sections
        </button>
      )}
    </div>
  )
}

/** The mark: gathered sheets bound at the spine. Same idea as the app icon. */
export function SpineMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path d="M6 5.5v23" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <path d="M11 7.5v19M16 6.5v21M21 8.5v17M26 7.5v19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.45" />
    </svg>
  )
}
