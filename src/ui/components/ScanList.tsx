import type { DocRef } from '../../core/types'

/**
 * Results of a whole-file scan, grouped by canvas page.
 *
 * Grouping matters: a marketing file usually has several documents sitting on one
 * canvas page and more on others. A flat list of section names loses the only context
 * that tells them apart.
 */

export interface ScanListProps {
  docs: DocRef[]
  selected: Set<string>
  onToggle: (docId: string) => void
  onBack: () => void
}

export function ScanList({ docs, selected, onToggle, onBack }: ScanListProps) {
  const groups = new Map<string, DocRef[]>()
  for (const doc of docs) {
    const existing = groups.get(doc.canvasPageName)
    if (existing) existing.push(doc)
    else groups.set(doc.canvasPageName, [doc])
  }

  if (docs.length === 0) {
    return (
      <div class="empty">
        <div class="empty-title">No sections found in this file.</div>
        <div class="empty-hint">
          Quire looks for sections at the top level of each canvas page. Wrap your document frames
          in a section to export them together.
        </div>
        <button class="link" onClick={onBack}>
          Back to selection
        </button>
      </div>
    )
  }

  return (
    <div class="sheet">
      {[...groups.entries()].map(([pageName, pageDocs]) => (
        <div key={pageName}>
          <div class="scan-group">{pageName}</div>
          {pageDocs.map((doc) => (
            <label class="scan-row" key={doc.id}>
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                onChange={() => onToggle(doc.id)}
              />
              <span class="scan-name">{doc.name}</span>
              <span class="scan-count">{doc.pages.length}</span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}
