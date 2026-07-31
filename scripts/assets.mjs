import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Render the icon and thumbnail from their SVG sources.
 *
 * Chrome rather than ImageMagick for the thumbnail: there is no librsvg delegate on a
 * default macOS ImageMagick, and its internal renderer silently drops the CSS and the
 * text, producing an empty frame rather than an error.
 */
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function chromeShot(svg, out, width, height, scale = 1) {
  await run(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--force-device-scale-factor=${scale}`,
    '--default-background-color=00000000',
    `--window-size=${width},${height}`,
    '--virtual-time-budget=3000',
    `--screenshot=${out}`,
    `file://${process.cwd()}/${svg}`,
  ]).catch((error) => {
    if (!String(error.stderr ?? '').includes('written to file')) throw error
  })
}

// Chrome will not open a window narrower than 500px, so the icon is rendered large and
// scaled down rather than requested at its final size.
await chromeShot('assets/icon.svg', '/tmp/quire-icon-raw.png', 512, 512, 1)
await run('magick', ['/tmp/quire-icon-raw.png', '-resize', '128x128', 'assets/icon-128.png'])
await run('magick', ['/tmp/quire-icon-raw.png', '-resize', '512x512', 'assets/icon-512.png'])

await chromeShot('assets/cover.svg', 'assets/cover.png', 1920, 1080, 1)

await run('magick', ['-background', 'none', '-density', '600', 'assets/mark.svg',
  '-resize', '256x256', 'assets/mark-256.png'])

console.log('assets/icon-128.png assets/icon-512.png assets/cover.png assets/mark-256.png')
