import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Render the icon and thumbnail from their SVG sources.
 *
 * Chrome rather than ImageMagick: there is no librsvg delegate on a default macOS
 * ImageMagick, and its internal renderer silently drops the CSS and text, producing an
 * empty frame rather than an error.
 *
 * Each SVG is wrapped in an HTML page that stretches it to the full viewport. Pointing
 * Chrome at an .svg file directly renders it at its *intrinsic* size, so a 128x128 icon
 * in a 512x512 window lands as a small mark in the top left corner with dead space
 * around it, and resizing that screenshot shrinks the artwork instead of the canvas.
 */
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Chrome refuses to open a window narrower than 500px, so anything smaller is rendered
// large and scaled down afterwards.
const MIN_WINDOW = 512

const work = await mkdtemp(join(tmpdir(), 'quire-assets-'))

async function render(svgPath, outPath, width, height) {
  const svg = await readFile(svgPath, 'utf8')

  // Drop the intrinsic size but keep the viewBox, so the CSS below controls scale.
  const scalable = svg.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, '<svg$1')

  const page = join(work, `${outPath.replace(/[^a-z0-9]/gi, '_')}.html`)
  await writeFile(
    page,
    `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  svg { display: block; width: 100vw; height: 100vh; }
</style>
${scalable}`,
  )

  await run(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=3000',
    `--screenshot=${outPath}`,
    `file://${page}`,
  ]).catch((error) => {
    if (!String(error.stderr ?? '').includes('written to file')) throw error
  })
}

// Icon: square, rendered above the minimum window width then scaled to each size.
const iconRaw = join(work, 'icon-raw.png')
await render('assets/icon.svg', iconRaw, MIN_WINDOW, MIN_WINDOW)
await run('magick', [iconRaw, '-resize', '128x128', 'assets/icon-128.png'])
await run('magick', [iconRaw, '-resize', '512x512', 'assets/icon-512.png'])

// Thumbnail: exactly the size the Figma Community asks for.
await render('assets/cover.svg', 'assets/cover.png', 1920, 1080)

// Bare mark, square, same treatment as the icon.
const markRaw = join(work, 'mark-raw.png')
await render('assets/mark.svg', markRaw, MIN_WINDOW, MIN_WINDOW)
await run('magick', [markRaw, '-resize', '256x256', 'assets/mark-256.png'])

/**
 * A mark stranded in the corner of an empty canvas is the exact failure this script
 * exists to prevent, and it exits cleanly when it happens. So measure the result:
 * artwork that fills its canvas has ink spread across it, not clustered in one corner.
 */
for (const file of ['assets/icon-128.png', 'assets/icon-512.png', 'assets/cover.png']) {
  const { stdout } = await run('magick', [file, '-format', '%[fx:mean]', 'info:'])
  const mean = Number.parseFloat(stdout)
  if (!Number.isFinite(mean) || mean < 0.02 || mean > 0.995) {
    throw new Error(`${file} looks blank or solid (mean ${stdout}). Check the SVG render.`)
  }

  // Compare the four quadrants. A corner-stranded render leaves three of them empty.
  const { stdout: quads } = await run('magick', [
    file, '-crop', '2x2@', '+repage', '-format', '%[fx:standard_deviation] ', 'info:',
  ])
  const spread = quads.trim().split(/\s+/).map(Number)
  const inked = spread.filter((s) => s > 0.01).length
  if (inked < 2) {
    throw new Error(
      `${file} has artwork in only ${inked} of 4 quadrants. It is probably rendered at ` +
        `its intrinsic size in a corner rather than filling the canvas.`,
    )
  }
}

console.log('assets/icon-128.png assets/icon-512.png assets/cover.png assets/mark-256.png')
