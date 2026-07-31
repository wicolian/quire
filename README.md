<p align="center">
  <img src="assets/icon-128.png" width="88" height="88" alt="Quire">
</p>

<h1 align="center">Quire</h1>

<p align="center">Export Figma sections as ordered, merged, genuinely compressed PDFs.</p>

<p align="center">
  <img src="assets/cover.png" alt="Quire — sections to PDF. Ordered, merged, compressed." width="820">
</p>

---

Figma can already export several frames as one PDF. Two things it will not do: let you
control the page order beyond canvas position, and compress the result. If your document
has screenshots in it, you get whatever size those images happen to be, and no way to
land under an attachment limit.

Quire is that missing half.

- **Select a section** — the frames inside it become your pages.
- **Order them** by canvas position or A–Z, or drag them. Your order is saved into the
  file, so re-exporting in three months does not mean re-dragging twelve rows.
- **Split anywhere** with break markers, or emit one PDF per page.
- **Set a size limit and hit it** — images inside the PDF are downsampled and re-encoded
  based on how large they are actually *drawn*, not their pixel dimensions.
- **Nothing is uploaded.** All PDF assembly and compression happens inside the plugin.

## How the compression works

Most "PDF compressors" either do nothing useful to a vector document or rasterize the
whole thing. Quire does neither by default.

```
1  export     each frame → Figma's own vector PDF
2  merge      combine into one document
3  dedupe     collapse identical streams (a logo on all 12 pages is embedded once)
4  placement  read the CTM at each `Do` to find each image's real drawn size
5  images     downsample + re-encode only what is above the target DPI
6  budget     over the cap? step quality down, retry (bounded at 3 passes)
7  fallback   still over? offer to flatten to raster — never silently
```

Step 4 is the part that matters. A 2000px logo placed at 40pt is being displayed at
~3600 DPI and is almost pure waste. The same bitmap spanning a full A4 page is a
reasonable 240 DPI and should be left nearly alone. Pixel dimensions alone cannot tell
those apart — only the transformation matrix in force when the image is painted can.

Text stays text. Fonts stay embedded. The document stays selectable and searchable
unless you explicitly ask for the raster fallback.

### What it deliberately does not do

Merging subsetted fonts. Figma subsets fonts per export, so page 1's Inter subset is
usually not byte-identical to page 5's and stream dedupe will not fire on them. Properly
merging subsets is a much harder problem and is out of scope — dedupe pays off on images
and repeated vector assets instead.

## Install (development)

```bash
git clone https://github.com/wicolian/quire.git
cd quire
npm install
npm run build
```

Then in Figma: **Plugins → Development → Import plugin from manifest…** and pick
`manifest.json` from this directory.

`npm run watch` rebuilds on change. Re-run the plugin in Figma to pick up a rebuild.

`npm run preview` renders the panel headlessly in both themes into `preview/`, with a
stubbed sandbox. It is a layout check — export, drag and download still need real Figma
— but it catches overflow, misalignment and contrast that collapses in one theme without
a round trip.

## Architecture

Figma plugins are two isolated realms, and the split follows that boundary:

```
┌─ SANDBOX (main) ──────────────┐      ┌─ UI (iframe) ────────────────────┐
│  figma API, no DOM            │      │  DOM, canvas, pdf-lib, fflate    │
│                               │ ───► │                                  │
│  selection.ts   discovery     │ msg  │  Preact panel                    │
│  order-store.ts pluginData    │ ◄─── │                                  │
│  exportAsync({PDF}) per node  │      │  core/  ← pure, no figma, no DOM │
└───────────────────────────────┘      └──────────────────────────────────┘
```

`src/core/` is the load-bearing boundary: pure functions over bytes and plain objects,
no `figma` global, no DOM. All the risk lives there, and it is the only layer that can
be tested outside Figma. Pixel encoding is injected through an `ImageCodec` adapter —
`OffscreenCanvas` in the plugin, a pure-JS codec in tests.

| Module | Responsibility |
|---|---|
| `core/ordering` | Natural sort, canvas sort, saved-order reconciliation |
| `core/merge` | pdf-lib merge, content-hash stream dedupe |
| `core/placement` | Content-stream CTM scan → real drawn size per image |
| `core/images` | Find, decode, downsample, re-encode image XObjects |
| `core/budget` | Preset → params, size search, give-up policy |
| `core/pipeline` | The whole export, start to finish |
| `core/raster` | The explicit flatten fallback |

## Tests

```bash
npm test
npm run typecheck
```

The suite builds its own PDF fixtures rather than committing binaries, so every input is
visible and adjustable. Those fixtures mimic the structures Figma emits — a vector page,
a DCTDecode photo, a Flate image with a soft mask, a logo repeated across pages — but
they are **synthetic**, and they cannot prove Quire survives everything real Figma output
contains.

To validate against the real thing: export some frames from Figma as PDF, one file per
frame, and drop them into `test/fixtures/real/`. `test/real-export.test.ts` picks them up
automatically and skips when the directory is empty. That directory is gitignored, so
nobody's confidential documents end up in a public repo.

## Design

The panel is built around one idea: **the spine.** A hairline binds the page list down
its left edge. Dropping a break marker severs it, so "these become separate PDFs" is
something you see rather than something you read off a radio button. During export, ink
fills the spine from the top, page by page — the progress indicator, the binding
indicator, and the list structure are the same mark.

The full design record is in
[`docs/superpowers/specs/`](docs/superpowers/specs/2026-07-31-quire-design.md).

## License

MIT — see [LICENSE](LICENSE).
