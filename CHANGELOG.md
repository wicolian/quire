# Changelog

## 0.1.0

First release. Quire exports Figma sections as ordered, merged, compressed PDFs.

### Why it exists

Figma can already export several frames as one PDF. It will not let you control page
order beyond canvas position, and it does not compress the result. A document with
screenshots comes out at whatever size those images happen to be, with no way to land
under an attachment limit. Quire is the missing half.

### Export and ordering

- Select a section on canvas and its top level frames become the pages of a PDF. A
  loose selection of frames works too, and is labelled as such since its order cannot
  be saved.
- `Scan whole file` walks every canvas page and lists all sections found, grouped by
  the page they live on.
- Four ordering modes: canvas position (left to right, top to bottom), A to Z, Z to A,
  and reverse. Rows can also be dragged by hand.
- Sorting is natural, so `D2-2` sorts before `D2-10` rather than after it. Zero padded
  names like `D2-01` work correctly either way.
- Canvas order bands rows by height tolerance, so a frame nudged a few pixels up does
  not jump ahead of its entire row.
- Manual order is written into the section as plugin data, so it travels with the file
  and survives reopening. Frames added since the last export are appended at the end
  and flagged `NEW` rather than being guessed into position. Deleted frames are dropped
  silently.
- Pages can be excluded from an export without deleting anything, shown as a
  strikethrough rather than an unchecked box.

### Output

- Combined mode produces one PDF per document, honouring break markers.
- Break markers can be dropped between any two pages to split a document into several
  PDFs at arbitrary points.
- Split mode produces one PDF per page.
- Two or more output files are bundled into a single ZIP, because a browser will only
  reliably trigger one download per user gesture.
- Filenames are sanitized for every major filesystem, Windows reserved device names are
  escaped, and collisions get numeric suffixes instead of silently overwriting.
- PDF bookmarks are generated from frame names, so a long document has a working
  outline in Preview and Acrobat.

### Compression

This is the part Figma's own export does not do at all.

- **Stream dedupe.** Merging per frame PDFs duplicates every shared resource. A logo
  present on all twelve pages arrives as twelve byte identical streams. Content hash
  dedupe collapses them. This is lossless and always runs. It repeats to a fixed point,
  because collapsing a shared soft mask makes its two parent images identical, which
  only becomes visible on the following pass.
- **Placement aware image compression.** Effective resolution depends on how large an
  image is *drawn*, not its pixel dimensions. Quire tokenizes each page's content
  stream, tracks the graphics state through `q`, `Q` and `cm` exactly as a renderer
  would, and records the largest size each image is painted at, recursing into form
  XObjects. A 2000px logo placed at 40pt is being shown at roughly 3600 DPI and is
  almost pure waste. The same bitmap across a full A4 page is a reasonable 240 DPI and
  is left nearly alone.
- **Handled formats.** JPEG (DCTDecode) and Flate encoded images in gray, RGB, CMYK and
  ICCBased colour spaces at 8 bits per component. Soft masks are downsampled alongside
  their parent so transparency survives and a 4000px mask is not left attached to a
  1200px image.
- **Left untouched on purpose.** JPX, CCITTFax, JBIG2, indexed palettes, separation and
  DeviceN spaces, and 1 bit stencil masks. Anything that cannot be handled confidently
  is skipped rather than guessed at.
- **The decisive guard.** An image is replaced only when the new bytes are both valid
  and genuinely smaller. A slightly larger PDF is a far better outcome than a corrupted
  one.
- **Conservative fallback.** If an image's placement cannot be determined, Quire assumes
  it spans the full page width. That under estimates its resolution and therefore under
  compresses it, which is the correct direction to fail in.

### File size limits

- Four presets: Email (10 MB cap, 150 DPI), Web (5 MB, 120 DPI), Print (uncapped, 300
  DPI) and Custom, which takes an exact number in MB.
- The compression loop is bounded. Overshooting the cap steps quality and resolution
  down proportionally to how far over it is, so a file 10 percent over gets a nudge
  while one at triple the cap drops hard. It stops after three passes, or as soon as
  neither axis can move without going below roughly 0.4 quality and 72 DPI.
- If the cap still cannot be met, Quire reports the real number ("9.1 MB, still over
  8 MB") and offers to flatten to raster. It never rasterizes silently.
- The raster fallback re-exports frames as images from Figma rather than shipping a PDF
  renderer, so the raster quality is Figma's own.
- An Advanced drawer exposes raw image DPI and JPEG quality for when a specific file
  needs fighting, plus a toggle to skip images already under the target DPI.

### Interface

- Built around the spine: a hairline binding the page list down its left edge, which
  physically severs at a break marker so combined versus split is visible rather than
  read off a radio button. During export, ink fills the spine top down, page by page,
  making the progress indicator and the list structure the same mark.
- Prepress palette: uncoated stock, warm press black that is never pure black,
  registration red used exactly once per screen, blueline blue for focus and
  information.
- Predominantly monospace with tabular figures, because this panel is almost entirely
  data and columns must not shift as values change.
- Borders only, no shadows. The panel floats over your artwork and shadows would
  compete with it.
- A drawn icon set on a 14px grid at 1.25 stroke weight, sized in em so icons scale
  with text.
- Light and dark themes, following Figma's own theme.
- **Resizable panel.** Drag the corner grip. Size is remembered per user.
- **Adjustable text size**, small, default or large, scaling the entire panel including
  icons and spacing.
- Motion tuned to the metaphor: sheets settle onto a stack, ink floods the spine, the
  blade cuts outward. One easing curve, three durations, no overshoot anywhere. Fully
  disabled under `prefers-reduced-motion`.

### Reliability

- One frame failing to export never costs the whole run. The rest complete and the
  failures are named: "11 of 12 pages exported. D2-06 failed."
- A corrupt source PDF is skipped rather than aborting the merge.
- Exports can be cancelled mid run, checked between pages.
- Mismatched page sizes are warned about inline and exported anyway.
- Losing a saved arrangement is never allowed to interrupt an export.

### Privacy

All PDF assembly and compression happens inside the plugin. There is no network code
and the manifest declares `"allowedDomains": ["none"]`.

### Known limitations

- Subsetted fonts are not merged. Figma subsets per export, so identical stream dedupe
  usually will not fire on fonts. Dedupe pays off on images and repeated vector assets
  instead.
- Drag reorder computes its target from a fixed row height, so a drag crossing a break
  marker is slightly less precise than one that does not.
- The test suite runs against generated fixtures that mimic Figma output. An opt in
  suite validates against real Figma exports placed in `test/fixtures/real/`.
