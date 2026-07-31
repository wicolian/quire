# Quire — Figma section → PDF export with real compression

**Date:** 2026-07-31
**Status:** Approved, in implementation

## Problem

Exporting a multi-page marketing document out of Figma today means Figma's native
multi-frame PDF export. It has two failures:

1. It is a separate flow from everything else, with no control over page order beyond
   canvas position.
2. It does not compress. A document with screenshots comes out at whatever size the
   embedded images happen to be, with no way to hit an email attachment limit.

The reference case is `Marketing-Assets` → section `Doc 2 — Databrain and Lightdash`
(node `47:848`): 12 frames named `D2-01 Cover` … `D2-12 Closing`, each 1240×1754
(A4 @ 150 DPI). Vector and text only, zero raster images. Sibling documents in the
same file do contain screenshots.

## Decisions

| Decision | Choice |
|---|---|
| Compression model | **Smart** — preserve the vector PDF, recompress/downsample only embedded image XObjects. Raster flatten offered as an explicit fallback when a size cap can't otherwise be met. Never rasterizes silently. |
| Scope model | **Selection-driven with file scan.** Selected section(s) = documents; their direct frame children = pages. A `Scan whole file` action walks every canvas page and lists all sections for batch export. |
| Size control | **Presets + custom cap.** Email safe (≤10 MB, 150 DPI), Web (≤5 MB, 120 DPI), Print (no cap, 300 DPI), Custom (exact MB). Advanced drawer exposes raw DPI + JPEG quality. Cap applies per output PDF. |
| Ordering | **Canvas order by default** (left→right, top→bottom), drag to reorder, A–Z / Z–A / Reverse one click away. Manual order persisted into the section via `pluginData`. New frames append at the end, flagged. |
| Output | **Combined / Split per page** toggle, plus break markers between any two pages for arbitrary chunking. Two or more files auto-ZIP. |
| Bookmarks | **In.** PDF outline generated from frame names. |
| Publishing | **Not published.** Manifest written publish-ready; the user publishes from a different account. |

## Architecture

Figma plugins are two isolated realms. The split follows:

```
┌─ SANDBOX (main thread) ───────┐      ┌─ UI (iframe) ────────────────────┐
│  figma API, no DOM            │      │  DOM, canvas, pdf-lib, fflate    │
│                               │      │                                  │
│  selection.ts                 │ ───► │  Preact panel                    │
│    section → child frames     │ msg  │    page list, drag, presets      │
│  order-store.ts               │ ◄─── │                                  │
│    read/write pluginData      │      │  core/  ← pure, no figma, no DOM │
│  export bridge                │      │    ordering  merge  images       │
│    exportAsync({PDF}) per node│      │    budget    naming  placement   │
└───────────────────────────────┘      └──────────────────────────────────┘
                                                    │
                                          Blob → <a download>
```

`core/` is the load-bearing boundary: pure functions over bytes and plain objects, no
`figma` global, no DOM. All risk lives there, and it is the only layer that can be
tested outside Figma.

Canvas re-encoding is the one thing `core/` cannot do purely, so it takes an
**`ImageCodec` adapter**: `OffscreenCanvas` in the browser, a pure-JS implementation
in Node tests.

### Rejected alternatives

- **Let Figma do the merge.** `exportAsync` is per-node and a PDF export of one node is
  one page. Native multi-frame PDF export is a UI feature, not exposed to the plugin
  API. *(Validated empirically in step 1 of implementation.)*
- **`mupdf-wasm` / Ghostscript-wasm.** 10–30 MB payload, slow cold start, CSP friction.
  Overkill for A4 marketing documents.
- **Server-side compression.** Confidential marketing documents leave the machine,
  requires hosting, kills offline use.

## Pipeline

```
1  sandbox   for each frame → exportAsync({format:'PDF'})  →  Uint8Array[]
2  merge     pdf-lib copyPages into one PDFDocument
             + content-hash dedupe of shared raw streams
3  placement scan content streams for CTM at each `Do` → real displayed size per image
4  images    walk indirect objects for /Subtype /Image
               DCTDecode   → decode, downsample, re-encode JPEG
               FlateDecode → inflate, downsample, re-encode (PNG-style Flate if /SMask)
               skip if already at or below target DPI
5  budget    over cap? step quality down, retry (max 3 passes)
             still over? → offer raster flatten (explicit user action)
6  outline   build PDF bookmarks from frame names
7  emit      1 file → download    2+ files → fflate zip → download
```

### Notes on step 2 (dedupe)

A logo present on all 12 pages is embedded 12 times by a naive merge. Content-hash
dedupe of raw streams removes that, and it is a certain saving.

Fonts are murkier: Figma subsets fonts per export, so page 1's Inter subset is likely
not byte-identical to page 5's, and identical-stream dedupe will not fire. Genuinely
merging subsetted fonts is out of scope. Expect dedupe to pay off on images and
repeated vector assets, not fonts.

Dedupe is restricted to `PDFRawStream` objects and skips `/Type /ObjStm`, so it can
never collapse two page objects into one shared reference.

### Notes on step 3 (placement)

Effective DPI of an embedded image depends on how large it is *drawn*, not its pixel
dimensions. The content stream is tokenized for `q` / `Q` / `cm` / `Do` to track the
graphics state and record the maximum drawn size in points per XObject, recursing one
level into Form XObjects.

If placement cannot be determined for an image, the fallback is conservative: assume
the image spans the full page width. That under-estimates its DPI and therefore
under-compresses. Failing toward "too little compression" is the correct direction —
never toward destroying an image.

## Modules

| Module | Responsibility | Depends on |
|---|---|---|
| `core/types` | Shared data shapes | — |
| `core/ordering` | Natural sort, canvas sort, saved-order reconciliation | types |
| `core/naming` | Filename sanitize, collision suffixing | types |
| `core/budget` | Preset → params, size search, give-up policy | types |
| `core/merge` | pdf-lib merge, raw-stream dedupe | pdf-lib |
| `core/placement` | Content-stream CTM scan → drawn size per XObject | pdf-lib |
| `core/images` | Find, decode, downsample, re-encode image XObjects | pdf-lib, placement, codec |
| `core/bookmarks` | PDF outline from page names | pdf-lib |
| `core/zip` | Multi-file bundling | fflate |
| `core/adapters/codec` | `ImageCodec` interface + browser/node implementations | — |
| `main/selection` | Section + frame discovery, file scan | figma |
| `main/order-store` | `pluginData` read/write | figma |
| `ui/*` | Panel | preact, core |

## UI

**User:** the designer, docked over the canvas seconds after their last edit, shipping a
PDF to a prospect. They have exported this document many times. The panel's job is to
confirm a known-good setup fast, not to teach options.

**Domain:** prepress — imposition, signatures, gathering, press check, plate, ink
coverage.

**Color world:** uncoated stock (warm off-white), press black (warm charcoal, never
`#000`), registration-mark red, blueline-proof blue, graphite, kraft chipboard.

**Signature element — the spine.** A hairline rule binding the page list down its left
edge. Where a break marker is dropped, the spine physically breaks, making
combined-vs-split legible at a glance rather than read off a radio button. During
export, ink fills the spine top-down as each page is pressed: the progress indicator,
the binding indicator, and the list structure are one mark.

**Defaults rejected:**

| Default | Instead |
|---|---|
| Checkbox list + "Select all" | Ordered, spine-bound list. Position number is the affordance; excluding a page is a strikethrough, not an unchecked box. |
| Blue primary "Export" button | Registration red, stating the outcome: `Export 3 PDFs · ~4.2 MB`. |
| Labeled `<select>` for quality | Segmented **stock selector**, with an ink gauge filling live against the cap. |
| Modal spinner | Ink fills the spine page by page — you see which page is on the press. |

**Type:** predominantly monospace with tabular figures for all data (page numbers,
dimensions, DPI, byte counts, filenames); sans only for controls and prose. This UI is
mostly data, and a proof sheet is typewritten.

**Depth:** borders-only, hairline, low-alpha. No shadows — the panel floats over the
user's canvas and shadows would fight the artwork behind it.

**Theme:** warm paper in Figma's light theme, warm charcoal in dark, switched off
Figma's own theme signal.

```
┌──────────────────────────────────────────┐
│  Doc 2 — Databrain and Lightdash    ↻    │
│  12 pages · A4 · 1240×1754               │
├──────────────────────────────────────────┤
│  Canvas ▾    A–Z   Z–A   ⇅               │
├──────────────────────────────────────────┤
│  │  01   D2-01 Cover                     │
│  ╵ ──── ✂ ────────────────────────────   │
│  │  02   D2-02 Introduction              │
│  │  03   D2-03 Comparison table          │
│  │  06   D̶2̶-̶0̶6̶ ̶S̶c̶r̶a̶t̶c̶h̶            │
│  │  07   D2-13 Pricing            ● new  │
├──────────────────────────────────────────┤
│  STOCK   ▪Email   Web   Print   Custom   │
│  ████████████░░░░░░░░░░   4.2 / 10 MB    │
│  › Advanced                              │
├──────────────────────────────────────────┤
│       Export 3 PDFs · ~4.2 MB            │
└──────────────────────────────────────────┘
```

## Error handling

| Condition | Behavior |
|---|---|
| Nothing selected | Empty state: "Select a section on the canvas." + `Scan whole file` |
| Selection is not a section | Offer: "7 frames selected. Export these as one document?" |
| Section has no direct frame children | "This section has no frames at its top level." Do not silently export nothing |
| One frame's `exportAsync` throws | Skip, continue, report at end: "11 of 12 pages exported. `D2-06` failed." Never lose the whole run to one bad node |
| Still over cap after 3 quality passes | Explicit prompt with the real number: "9.1 MB — still over 8 MB. Flatten to raster?" |
| Saved order references deleted nodes | Drop silently; append genuinely-new frames at the end tagged `new` |
| Document over 50 pages | Chunked merge with a working Cancel |
| Frames with mismatched dimensions | Inline warning listing the distinct sizes; export proceeds |

## Testing

The Figma sandbox is close to untestable, so all risk is pushed into `core/`. Those
modules run under vitest in Node against real Figma-exported PDF fixtures committed to
the repo: one vector-only, one screenshot-heavy, one with transparency.

- `ordering` — natural sort (`D2-2` before `D2-10`), persistence round-trip,
  reconciling saved order against added and deleted nodes
- `merge` — page count, page order preserved, dedupe measurably reduces bytes
- `placement` — CTM tracking through `q`/`Q`/`cm`, Form XObject recursion, fallback
- `images` — DCTDecode and FlateDecode paths, `/SMask` transparency survives,
  already-small images skipped
- `budget` — preset → params, converges under cap, gives up cleanly after 3 passes
- `naming` — sanitization, collision suffixes

The `ImageCodec` adapter is what makes this work: pure-JS codec in Node tests,
`OffscreenCanvas` in the plugin.

## Stack

TypeScript, esbuild, Preact (3 KB — the drag list needs reconciliation), pdf-lib,
fflate. No network access declared in the manifest.

## Out of scope

Page numbers, headers/footers, watermarks, password protection, PDF/A, cloud upload,
custom page sizes, crop marks, merging subsetted fonts.
