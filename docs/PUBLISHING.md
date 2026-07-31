# Publishing Quire to the Figma Community

**Publishing cannot be automated.** Figma has no API, CLI or MCP endpoint for submitting
a plugin. Their own documentation is explicit: "You can only submit plugins from the
Figma desktop app." A Figma personal access token does not help either, because the REST
API has no plugin publishing surface at all.

Everything below is prepared so the submission itself takes a few minutes.

Publish from the **koushiktwitter** account.

---

## Before you start

1. **Confirm the active account.** Figma desktop, click your avatar, make sure the
   active account is the personal one and not the Databrain one. Whichever account
   publishes owns the plugin permanently, and moving it later means transferring or
   republishing from scratch.

2. **Remove the development plugin id.** `manifest.json` currently carries a
   placeholder:

   ```json
   "id": "quire-pdf-export-local-dev"
   ```

   Figma assigns a real id on first publish. Delete that line before publishing, or let
   Figma overwrite it. Do not ship the placeholder.

3. **Build fresh.** `npm run build`. The `dist/` directory is gitignored, so a clean
   clone must build before importing.

4. **Run it against a real document once.** Ideally one with screenshots in it, since a
   vector only document exercises none of the compression path.

## The submission

1. Figma desktop, open any file.
2. Click the Figma logo, top left, then `Plugins` then `Manage plugins`.
3. Click the icon next to Quire and choose `Publish`.
4. **Describe your resource:** use the copy below.
5. **Choose some images:** icon and thumbnail from `assets/`, listed below.
6. **Data security:** complete the disclosure form. Quire's answers are simple, see
   below.
7. **Final details:** publish as yourself, add a support contact, confirm the network
   access label reads `No access to network`.
8. Submit. Review can take up to two weeks.

---

## Listing copy

### Name

```
Quire
```

### Tagline

```
Sections to PDF. Ordered, merged, actually compressed.
```

### Description

```
Figma can export several frames as one PDF. It will not let you control the page order,
and it will not compress the result. So a document with screenshots comes out at
whatever size the images happen to be, with no way to land under an attachment limit.

Quire is the missing half.

SELECT A SECTION
The frames inside it become your pages. Loose frame selections work too.

ORDER THEM PROPERLY
Canvas position, A to Z, Z to A, or drag them yourself. Natural sort, so "D2-2" comes
before "D2-10" instead of after it. Your manual order is saved into the file, so
re-exporting in three months does not mean re-dragging twelve rows. New frames appear
at the end, flagged, instead of being guessed into position.

SPLIT ANYWHERE
Drop a break marker between any two pages to cut the document into separate PDFs. Or
emit one PDF per page. Multiple files come down as a single ZIP.

SET A SIZE LIMIT AND HIT IT
Pick a preset, Email at 10 MB, Web at 5 MB, Print uncapped, or type an exact number.
Quire downsamples and re-encodes the images inside your PDF based on how large they are
actually drawn, not their pixel dimensions. A 2000px logo placed at 40pt is being shown
at roughly 3600 DPI and is nearly pure waste. The same bitmap across a full page is
fine and gets left alone.

Text stays text. Fonts stay embedded. Your PDF stays selectable and searchable. If a
size cap genuinely cannot be met, Quire tells you the real number and offers to flatten
to raster. It never does that silently.

ALSO
PDF bookmarks generated from your frame names. Resizable panel and adjustable text
size. Light and dark themes.

NOTHING LEAVES YOUR MACHINE
All PDF assembly and compression happens inside the plugin. No uploads, no servers, no
network access at all.

Open source, MIT licensed: https://github.com/wicolian/quire
```

### Tags

Figma allows a limited number, so these are ordered by search value. People search for
the problem, not for the plugin name.

```
pdf
export
compress
merge
print
documents
presentation
sections
```

### Category

`Utilities`. Secondary if offered: `Design tools`.

---

## Images

| Asset | File | Size |
| --- | --- | --- |
| Plugin icon | `assets/icon-128.png` | 128 x 128 |
| Thumbnail | `assets/cover-1920x1080.png` | 1920 x 1080 |
| Spare high res icon | `assets/icon-512.png` | 512 x 512 |

Note that Figma asks for a **1920 x 1080** thumbnail. `assets/cover.png` is 1920 x 960,
which is the older ratio, so use `cover-1920x1080.png`.

Sources are `assets/icon.svg` and `assets/cover.svg`. To re-render after editing:

```bash
npm run assets
```

ImageMagick alone cannot render `cover.svg`, since there is no librsvg delegate
installed and the internal renderer drops the CSS and text. The script uses Chrome for
that one.

---

## Data security disclosure

Quire's answers are straightforward, since it does nothing over the network:

- **Does the plugin access the network?** No. The manifest declares
  `"allowedDomains": ["none"]`.
- **Does it collect or transmit user data?** No.
- **Does it store data?** Yes, locally only. Page order is stored on the section as
  plugin data inside the user's own file. Panel size and text size are stored in
  `figma.clientStorage`, which is local to the user's machine.
- **Third party services?** None.
- **Analytics or telemetry?** None.

---

## After publishing

The plugin gets a Community URL of the form
`https://www.figma.com/community/plugin/<id>/quire`. Add it to the README install
section, replacing the "not yet on the Figma Community" note.
