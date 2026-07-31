# Publishing Quire to the Figma Community

**Publishing cannot be automated.** Figma has no API, CLI, or MCP endpoint for
submitting a plugin — it is a Figma desktop app flow, and it goes through human review.
Everything below is prepared so the actual submission takes a couple of minutes.

Publish from the **koushikwitter@gmail.com** account.

---

## Before you start

1. **Sign into the right account.** Figma desktop → avatar → make sure the active
   account is `koushikwitter@gmail.com`, not the Databrain one. The plugin is owned
   permanently by whichever account publishes it, and moving it later means
   transferring or republishing.

2. **Change the plugin id.** `manifest.json` currently has a development id:

   ```json
   "id": "quire-pdf-export-local-dev"
   ```

   Figma assigns a real id the first time you publish. Delete the `id` line entirely
   before publishing, or let Figma overwrite it — do not keep the placeholder.

3. **Build fresh.** `npm run build`. The `dist/` directory is gitignored, so a clean
   clone has to build before importing.

## The submission

1. Figma desktop → open any file → **Plugins → Development → Import plugin from
   manifest…** → choose `manifest.json`.
2. Run it once and confirm it works against a real section.
3. **Plugins → Development → Quire → Publish…**
4. Fill in the listing using the copy below.
5. Upload the assets from `assets/`.
6. Submit. Review typically takes a few days.

---

## Listing copy

### Name

```
Quire
```

### Tagline (max ~60 chars)

```
Sections to PDF. Ordered, merged, actually compressed.
```

### Description

```
Figma can export several frames as one PDF. It won't let you control the page order,
and it won't compress the result — so a document with screenshots comes out at whatever
size the images happen to be, with no way to land under an attachment limit.

Quire is that missing half.

SELECT A SECTION
The frames inside it become your pages. Or select loose frames and export those.

ORDER THEM PROPERLY
Canvas position, A–Z, Z–A, or drag them yourself. Natural sort, so "D2-2" comes before
"D2-10" instead of after it. Your manual order is saved into the file — re-exporting in
three months doesn't mean re-dragging twelve rows.

SPLIT ANYWHERE
Drop a break marker between any two pages to cut the document into separate PDFs. Or
emit one PDF per page. Multiple files come down as a single ZIP.

SET A SIZE LIMIT AND HIT IT
Pick a stock — Email (10 MB), Web (5 MB), Print (uncapped), or type an exact number.
Quire downsamples and re-encodes the images inside your PDF based on how large they're
actually drawn, not their pixel dimensions. A 2000px logo placed at 40pt is being shown
at ~3600 DPI and is nearly pure waste; the same bitmap across a full page is fine and
gets left alone.

Text stays text. Fonts stay embedded. Your PDF stays selectable and searchable. If a
size cap genuinely can't be met, Quire tells you the real number and offers to flatten
to raster — it never does that silently.

NOTHING LEAVES YOUR MACHINE
All PDF assembly and compression happens inside the plugin. No uploads, no servers, no
network access at all.

Open source: https://github.com/wicolian/quire
```

### Tags

```
pdf, export, print, documents, compression, presentation, sections, merge
```

### Category

`Utilities` (secondary: `Design tools`)

---

## Assets

| Asset | File | Size |
|---|---|---|
| Plugin icon | `assets/icon-128.png` | 128×128 |
| Cover art | `assets/cover.png` | 1920×960 |
| High-res icon (spare) | `assets/icon-512.png` | 512×512 |

Sources are `assets/icon.svg` and `assets/cover.svg`. To re-render after editing:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd assets
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1920,960 --screenshot=cover.png "file://$PWD/cover.svg"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=4 \
  --default-background-color=00000000 --window-size=128,128 \
  --screenshot=/tmp/icon-raw.png "file://$PWD/icon.svg"
magick /tmp/icon-raw.png -resize 128x128 icon-128.png
magick /tmp/icon-raw.png -resize 512x512 icon-512.png
```

ImageMagick alone will not render `cover.svg` — there is no librsvg delegate installed,
and the internal renderer drops the CSS and text. Chrome is required for that one.

---

## Worth doing before you submit

- **Run it against a real document.** Export `Doc 2 — Databrain and Lightdash` from
  Marketing-Assets and check the page order, the bookmarks, and the file size.
- **Test a document with screenshots.** The compression path does nothing on a
  vector-only document — that is correct behaviour, but it means a vector document
  proves nothing about compression.
- **Drop those exports into `test/fixtures/real/`** and run `npm test`. The real-export
  suite skips when that directory is empty; it is the only check that exercises genuine
  Figma output rather than synthetic fixtures.
- **Decide on the network access declaration.** The manifest declares
  `"allowedDomains": ["none"]`, which is accurate and worth keeping — reviewers and
  users both read it.
