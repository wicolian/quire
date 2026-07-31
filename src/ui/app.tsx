import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { estimateBytes, resolveParams } from '../core/budget'
import { formatBytes } from '../core/naming'
import { groupByBreaks, movePage, reconcile, sortPages } from '../core/ordering'
import { CancelledError, runPipeline } from '../core/pipeline'
import { buildRasterPdf, scaleForDpi } from '../core/raster'
import { browserCodec } from '../core/adapters/codec.browser'
import {
  DEFAULT_SETTINGS,
  EMPTY_ARRANGEMENT,
  type Arrangement,
  type DocRef,
  type ExportReport,
  type ExportSettings,
  type PageRef,
  type SortMode,
} from '../core/types'
import type { MainToUi } from '../shared/messages'
import { onMessage, requestPages, send, yieldToUi } from './bridge'
import { deliver } from './download'
import { Controls } from './components/Controls'
import { EmptyState } from './components/EmptyState'
import { PageList } from './components/PageList'
import { ScanList } from './components/ScanList'

/**
 * Quire's state.
 *
 * One document is "current" at a time — the one selected on the canvas. The scan view
 * is a separate mode rather than a merged list, because batch-exporting five documents
 * and arranging one document are different tasks and mixing their controls would serve
 * neither.
 */

type Mode = 'document' | 'scan'

interface Busy {
  stage: 'exporting' | 'assembling' | 'images'
  done: number
  total: number
}

export function App() {
  const [docs, setDocs] = useState<DocRef[]>([])
  const [arrangement, setArrangement] = useState<Arrangement>(EMPTY_ARRANGEMENT)
  const [newPageIds, setNewPageIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [mode, setMode] = useState<Mode>('document')
  const [scanDocs, setScanDocs] = useState<DocRef[]>([])
  const [scanSelected, setScanSelected] = useState<Set<string>>(new Set())
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [flattenOffer, setFlattenOffer] = useState<{ filename: string; bytes: number; cap: number } | null>(null)

  const cancelSignal = useRef({ cancelled: false })
  const doc = docs[0] ?? null

  // ── sandbox messages ──────────────────────────────────────────────────────

  useEffect(() => {
    const stop = onMessage((message: MainToUi) => {
      if (message.type === 'selection') {
        setDocs(message.docs)
        const first = message.docs[0]
        if (first) {
          const result = reconcile(first.pages, message.arrangements[first.id] ?? null)
          setArrangement(result.arrangement)
          setNewPageIds(new Set(result.newPageIds))
        } else {
          setArrangement(EMPTY_ARRANGEMENT)
          setNewPageIds(new Set())
        }
        setReport(null)
        setFlattenOffer(null)
        return
      }

      if (message.type === 'scan-progress') {
        setScanProgress({ done: message.done, total: message.total })
        return
      }

      if (message.type === 'scan-result') {
        setScanning(false)
        setScanProgress(null)
        setScanDocs(message.docs)
        setScanSelected(new Set(message.docs.map((d) => d.id)))
        setMode('scan')
      }
    })

    send({ type: 'ui-ready' })
    return stop
  }, [])

  // ── derived ordering ──────────────────────────────────────────────────────

  /** Pages in export order, including excluded ones so the list can strike them. */
  const orderedPages = useMemo<PageRef[]>(() => {
    if (!doc) return []
    const byId = new Map(doc.pages.map((page) => [page.id, page]))
    const ordered: PageRef[] = []
    for (const id of arrangement.order) {
      const page = byId.get(id)
      if (page) ordered.push(page)
    }
    // Anything the arrangement does not mention yet (a frame added since the last
    // reconcile) still has to be visible.
    for (const page of doc.pages) {
      if (!arrangement.order.includes(page.id)) ordered.push(page)
    }
    return ordered
  }, [doc, arrangement.order])

  const excluded = useMemo(() => new Set(arrangement.excluded), [arrangement.excluded])
  const breaks = useMemo(() => new Set(arrangement.breaks), [arrangement.breaks])
  const includedPages = useMemo(
    () => orderedPages.filter((page) => !excluded.has(page.id)),
    [orderedPages, excluded],
  )

  const fileCount = useMemo(() => {
    if (includedPages.length === 0) return 0
    if (settings.output === 'split') return includedPages.length
    return groupByBreaks(includedPages, arrangement.breaks).length
  }, [includedPages, settings.output, arrangement.breaks])

  const params = resolveParams(settings)
  const estimated = estimateBytes(includedPages.length, 0, params)
  const measured = report?.files.reduce((sum, file) => sum + file.bytes.length, 0) ?? null

  // ── arrangement mutations ─────────────────────────────────────────────────

  const persist = useCallback(
    (next: Arrangement) => {
      setArrangement(next)
      if (doc && !doc.adHoc) {
        send({ type: 'save-arrangement', docId: doc.id, arrangement: next })
      }
    },
    [doc],
  )

  const applySort = useCallback(
    (sortMode: SortMode) => {
      if (!doc) return
      const sorted = sortPages(orderedPages, sortMode)
      persist({ ...arrangement, sortMode, order: sorted.map((page) => page.id) })
    },
    [doc, orderedPages, arrangement, persist],
  )

  const handleReorder = useCallback(
    (from: number, to: number) => {
      // Any manual move means the user has overridden the sort; saying so keeps the
      // A–Z button from silently undoing their work on the next open.
      persist({ ...arrangement, sortMode: 'manual', order: movePage(arrangement.order, from, to) })
    },
    [arrangement, persist],
  )

  const toggleExcluded = useCallback(
    (pageId: string) => {
      const next = excluded.has(pageId)
        ? arrangement.excluded.filter((id) => id !== pageId)
        : [...arrangement.excluded, pageId]
      persist({ ...arrangement, excluded: next })
    },
    [arrangement, excluded, persist],
  )

  const toggleBreak = useCallback(
    (pageId: string) => {
      const next = breaks.has(pageId)
        ? arrangement.breaks.filter((id) => id !== pageId)
        : [...arrangement.breaks, pageId]
      persist({ ...arrangement, breaks: next })
    },
    [arrangement, breaks, persist],
  )

  // ── export ────────────────────────────────────────────────────────────────

  const runExport = useCallback(async () => {
    if (!doc || includedPages.length === 0) return

    cancelSignal.current = { cancelled: false }
    setReport(null)
    setFlattenOffer(null)
    setBusy({ stage: 'exporting', done: 0, total: includedPages.length })

    try {
      const collected = await requestPages(
        includedPages.map((page) => page.id),
        {
          signal: cancelSignal.current,
          onPage: (done, total) => setBusy({ stage: 'exporting', done, total }),
        },
      )

      if (cancelSignal.current.cancelled) {
        setBusy(null)
        return
      }

      setBusy({ stage: 'assembling', done: 0, total: fileCount })
      await yieldToUi()

      const result = await runPipeline({
        docName: doc.name,
        pages: includedPages,
        pdfBytes: collected.bytes,
        breaks: arrangement.breaks,
        mode: settings.output,
        bookmarks: settings.bookmarks,
        params,
        codec: browserCodec,
        shouldCancel: () => cancelSignal.current.cancelled,
        onProgress: (stage, done, total) => {
          setBusy({ stage: stage === 'images' ? 'images' : 'assembling', done, total })
        },
      })

      for (const failure of collected.failures) {
        const page = includedPages.find((p) => p.id === failure.pageId)
        result.failedPages.push({
          id: failure.pageId,
          name: page?.name ?? failure.pageId,
          reason: failure.reason,
        })
      }

      setBusy(null)
      setReport(result)

      const delivered = deliver(result.files, doc.name)
      if (delivered) {
        send({
          type: 'notify',
          message:
            result.failedPages.length > 0
              ? `${delivered.filename} — ${result.failedPages.length} page(s) failed`
              : `${delivered.filename} downloaded`,
          error: result.failedPages.length > 0,
        })
      }

      // Only offer flattening when compression genuinely could not get there.
      if (result.overCap.length > 0) {
        const worst = result.overCap[0]
        setFlattenOffer({ filename: worst.filename, bytes: worst.bytes, cap: worst.capBytes })
      }
    } catch (error) {
      setBusy(null)
      if (!(error instanceof CancelledError)) {
        send({
          type: 'notify',
          message: error instanceof Error ? error.message : 'Export failed',
          error: true,
        })
      }
    }
  }, [doc, includedPages, arrangement.breaks, settings, params, fileCount])

  /**
   * The explicit flatten fallback.
   *
   * Re-exports the frames as images from Figma and rebuilds the PDF from those. Only
   * ever reachable by pressing the button that says what it costs.
   */
  const runFlatten = useCallback(async () => {
    if (!doc || includedPages.length === 0) return

    cancelSignal.current = { cancelled: false }
    setFlattenOffer(null)
    setBusy({ stage: 'exporting', done: 0, total: includedPages.length })

    try {
      const scale = scaleForDpi(params.dpi)
      const collected = await requestPages(
        includedPages.map((page) => page.id),
        {
          format: 'raster',
          scale,
          signal: cancelSignal.current,
          onPage: (done, total) => setBusy({ stage: 'exporting', done, total }),
        },
      )

      setBusy({ stage: 'assembling', done: 0, total: includedPages.length })
      await yieldToUi()

      const bytes = await buildRasterPdf({
        docName: doc.name,
        pages: includedPages,
        images: collected.bytes,
        scale,
        quality: params.quality,
        bookmarks: settings.bookmarks,
        codec: browserCodec,
        onProgress: (done, total) => setBusy({ stage: 'assembling', done, total }),
      })

      setBusy(null)
      if (!bytes) {
        send({ type: 'notify', message: 'Flatten produced no pages', error: true })
        return
      }

      const file = {
        filename: `${doc.name.replace(/[^\w -]/g, '').trim() || 'Document'}-flat.pdf`,
        bytes,
        pageCount: includedPages.length,
      }
      setReport({
        files: [file],
        failedPages: [],
        overCap:
          params.capBytes !== null && bytes.length > params.capBytes
            ? [{ filename: file.filename, bytes: bytes.length, capBytes: params.capBytes }]
            : [],
        imagesRecompressed: includedPages.length,
        bytesSavedByDedupe: 0,
        bytesSavedByImages: 0,
      })
      deliver([file], doc.name)
      send({ type: 'notify', message: `${file.filename} downloaded — ${formatBytes(bytes.length)}` })
    } catch (error) {
      setBusy(null)
      if (!(error instanceof CancelledError)) {
        send({
          type: 'notify',
          message: error instanceof Error ? error.message : 'Flatten failed',
          error: true,
        })
      }
    }
  }, [doc, includedPages, params, settings.bookmarks])

  // ── render ────────────────────────────────────────────────────────────────

  if (mode === 'scan') {
    const selectedDocs = scanDocs.filter((d) => scanSelected.has(d.id))
    const totalPages = selectedDocs.reduce((sum, d) => sum + d.pages.length, 0)

    return (
      <div class="app">
        <div class="masthead">
          <div class="masthead-row">
            <div class="doc-name">Whole file</div>
            <button class="icon-button" onClick={() => setMode('document')} title="Back to selection">
              ✕
            </button>
          </div>
          <div class="doc-meta mono">
            {scanDocs.length} section{scanDocs.length === 1 ? '' : 's'} · {totalPages} pages selected
          </div>
        </div>

        <ScanList
          docs={scanDocs}
          selected={scanSelected}
          onToggle={(docId) => {
            const next = new Set(scanSelected)
            if (next.has(docId)) next.delete(docId)
            else next.add(docId)
            setScanSelected(next)
          }}
          onBack={() => setMode('document')}
        />

        <div class="footer">
          <button
            class="export secondary"
            onClick={() => {
              // Batch export is a sequence of single-document exports; selecting a
              // document on canvas is how you arrange it, so this hands back rather
              // than pretending order can be edited for five documents at once.
              send({
                type: 'notify',
                message: 'Select a section on the canvas to arrange and export it.',
              })
              setMode('document')
            }}
            disabled={selectedDocs.length === 0}
          >
            Open {selectedDocs.length} section{selectedDocs.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    )
  }

  if (!doc) {
    return (
      <div class="app">
        <EmptyState
          reason="no-selection"
          scanning={scanning}
          scanProgress={scanProgress}
          onScan={() => {
            setScanning(true)
            send({ type: 'scan-file' })
          }}
        />
      </div>
    )
  }

  if (doc.pages.length === 0) {
    return (
      <div class="app">
        <EmptyState
          reason="empty-section"
          sectionName={doc.name}
          scanning={scanning}
          scanProgress={scanProgress}
          onScan={() => {
            setScanning(true)
            send({ type: 'scan-file' })
          }}
        />
      </div>
    )
  }

  const sizes = new Set(includedPages.map((p) => `${Math.round(p.width)}×${Math.round(p.height)}`))
  const pressedCount =
    busy?.stage === 'exporting' ? busy.done : busy ? includedPages.length : report ? includedPages.length : 0

  return (
    <div class="app">
      <div class="masthead">
        <div class="masthead-row">
          <div class="doc-name" title={doc.name}>
            {doc.name}
          </div>
          <button
            class="icon-button"
            onClick={() => send({ type: 'refresh' })}
            title="Reload from canvas"
            disabled={!!busy}
          >
            ↻
          </button>
        </div>
        <div class="doc-meta mono">
          {includedPages.length} page{includedPages.length === 1 ? '' : 's'}
          {excluded.size > 0 && ` · ${excluded.size} left out`}
          {sizes.size === 1 && ` · ${[...sizes][0]}`}
          {doc.adHoc && ' · loose selection'}
        </div>
      </div>

      <div class="orderbar">
        <button
          class="chip"
          aria-pressed={arrangement.sortMode === 'canvas'}
          onClick={() => applySort('canvas')}
          disabled={!!busy}
        >
          Canvas
        </button>
        <button
          class="chip"
          aria-pressed={arrangement.sortMode === 'alpha'}
          onClick={() => applySort('alpha')}
          disabled={!!busy}
        >
          A–Z
        </button>
        <button
          class="chip"
          aria-pressed={arrangement.sortMode === 'alpha-desc'}
          onClick={() => applySort('alpha-desc')}
          disabled={!!busy}
        >
          Z–A
        </button>
        <button
          class="chip"
          onClick={() =>
            persist({ ...arrangement, sortMode: 'manual', order: [...arrangement.order].reverse() })
          }
          disabled={!!busy}
          title="Reverse the current order"
        >
          ⇅
        </button>
        <div class="orderbar-spacer" />
        {arrangement.sortMode === 'manual' && <span class="chip mono">manual</span>}
      </div>

      {sizes.size > 1 && (
        <div class="notice">
          <span class="notice-mark" aria-hidden="true">
            ⚠
          </span>
          <span>
            Mixed page sizes: {[...sizes].join(', ')}. The PDF will keep each page at its own size.
          </span>
        </div>
      )}

      {doc.adHoc && (
        <div class="notice">
          <span class="notice-mark" aria-hidden="true">
            ℹ
          </span>
          <span>Loose frame selection — this order is not saved. Wrap them in a section to keep it.</span>
        </div>
      )}

      {report && report.failedPages.length > 0 && (
        <div class="notice warn">
          <span class="notice-mark" aria-hidden="true">
            ⚠
          </span>
          <span>
            {report.files.reduce((sum, f) => sum + f.pageCount, 0)} of {includedPages.length} pages
            exported. Failed: {report.failedPages.map((f) => f.name).join(', ')}
          </span>
        </div>
      )}

      {flattenOffer && (
        <div class="notice warn">
          <span class="notice-mark" aria-hidden="true">
            ⚠
          </span>
          <span>
            {formatBytes(flattenOffer.bytes)} — still over {formatBytes(flattenOffer.cap)} after
            compressing. Flattening rasterizes the pages: smaller, but the text stops being
            selectable.
            <div class="notice-actions">
              <button class="link" onClick={runFlatten}>
                Flatten to raster
              </button>
              <button class="link" onClick={() => setFlattenOffer(null)}>
                Keep as is
              </button>
            </div>
          </span>
        </div>
      )}

      <PageList
        pages={orderedPages}
        excluded={excluded}
        breaks={breaks}
        newPageIds={newPageIds}
        pressedCount={pressedCount}
        busy={!!busy}
        onReorder={handleReorder}
        onToggleExcluded={toggleExcluded}
        onToggleBreak={toggleBreak}
        onReveal={(pageId) => send({ type: 'select-node', nodeId: pageId })}
      />

      <Controls
        settings={settings}
        estimatedBytes={estimated}
        measuredBytes={measured}
        onChange={setSettings}
        busy={!!busy}
      />

      <div class="footer">
        {busy ? (
          <>
            <button
              class="export secondary"
              onClick={() => {
                cancelSignal.current.cancelled = true
              }}
            >
              Cancel
            </button>
            <div class="progress-line">
              {busy.stage === 'exporting' && `Pressing page ${busy.done} of ${busy.total}`}
              {busy.stage === 'images' && `Compressing images ${busy.done}/${busy.total}`}
              {busy.stage === 'assembling' && 'Assembling…'}
            </div>
          </>
        ) : (
          <button class="export" onClick={runExport} disabled={includedPages.length === 0}>
            <span>
              Export {fileCount} PDF{fileCount === 1 ? '' : 's'}
            </span>
            <span class="export-figure">
              {measured === null ? '~' : ''}
              {formatBytes(measured ?? estimated)}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
