import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Render the panel headlessly so layout can be checked without a round trip through
 * Figma.
 *
 * The UI realm only needs a sandbox to talk to, so this stubs the message it actually
 * depends on, the `selection` reply, and renders `dist/ui.html` in Chrome at the
 * real panel width. It catches the class of bug that costs the most time otherwise:
 * overflow, misalignment, contrast that collapses in one theme.
 *
 *   npm run preview
 *
 * It is a layout check, not a functional one. Export, drag and download all need real
 * Figma.
 */

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = 'preview'
const WIDTH = 420
const HEIGHT = 640

/**
 * Headless Chrome refuses to open a window narrower than 500px, so `--window-size=420`
 * silently yields a 500px viewport. Screenshotting at 420 then crops off 80px and
 * makes correct layout look like overflow. The fix is to pin the document to the real
 * panel size, render in a larger window, and crop back down.
 */
const WINDOW = { width: 640, height: 760 }

const PIN = `
<style>
  html, body {
    width: ${WIDTH}px !important;
    height: ${HEIGHT}px !important;
    overflow: hidden !important;
  }
</style>`

const PAGES = [
  'D3-01 Cover',
  'D3-02 What this covers',
  'D3-03 Your current architecture',
  'D3-04 How Databrain models tenancy',
  'D3-05 The recommended pattern',
  'D3-06 How a query resolves',
  'D3-07 Why this matters for Klir',
  'D3-08 Guest token and security model',
  'D3-09 Rollout plan',
  'D3-10 Open questions',
  'D3-11 Appendix',
]

function harness({ dark, stock, breaks, excluded, press }) {
  return `
<script>
(function(){
  // Not an iframe here, so window.parent === window and postMessage is the very
  // function the bundle sends on. Capture the original before overriding, or the
  // stub eats its own delivery.
  var original = window.postMessage.bind(window);

  var pages = ${JSON.stringify(PAGES)}.map(function(n, i){
    return { id: "p" + i, name: n, x: i * 1400, y: 0, width: 1240, height: 1754 };
  });

  var doc = {
    id: "sec1",
    name: "Doc 3 Klir Multi-Tenant on Azure SQL Server",
    canvasPageId: "c1", canvasPageName: "Docs",
    pages: pages, adHoc: false
  };

  var arrangement = {
    version: 1, sortMode: "canvas",
    order: pages.map(function(p){ return p.id; }),
    excluded: ${JSON.stringify(excluded ?? [])},
    breaks: ${JSON.stringify(breaks ?? [])}
  };

  window.postMessage = function(payload, origin){
    var m = payload && payload.pluginMessage;
    if (m && (m.type === "ui-ready" || m.type === "refresh")) {
      setTimeout(function(){
        original({ pluginMessage: {
          type: "selection", docs: [doc], arrangements: { sec1: arrangement }
        }}, "*");
      }, 0);
      return;
    }
    return original(payload, origin);
  };

  ${dark ? 'document.documentElement.classList.add("figma-dark");' : ''}

  ${
    stock
      ? `document.addEventListener("click", function(){}, true);
         setTimeout(function(){
           var b = [].slice.call(document.querySelectorAll(".segment"))
             .filter(function(el){ return el.textContent.trim() === ${JSON.stringify(stock)}; })[0];
           if (b) b.click();
           var adv = document.querySelector(".disclosure");
           if (adv) adv.click();
         }, 120);`
      : ''
  }

  ${
    press
      ? `// Marks rows pressed at a known moment so the ink fill can be caught partway
         // through. The real trigger is export progress; this only exercises the CSS.
         setTimeout(function(){
           [].slice.call(document.querySelectorAll(".row"))
             .slice(0, ${press}).forEach(function(row){ row.classList.add("pressed"); });
         }, 1000);`
      : ''
  }
})();
</script>`
}

const SHOTS = [
  { name: 'dark', dark: true },
  { name: 'light', dark: false },
  { name: 'dark-advanced', dark: true, stock: 'Custom' },
  { name: 'dark-breaks', dark: true, breaks: ['p2', 'p6'], excluded: ['p4'] },
  // Ink flooding the spine, caught at three points through a 200ms transition that
  // starts at t=1000. If these three frames are identical, the animation is not running.
  { name: 'ink-0', dark: true, press: 6, budget: 1010 },
  { name: 'ink-mid', dark: true, press: 6, budget: 1080 },
  { name: 'ink-done', dark: true, press: 6, budget: 1400 },
]

const shell = await readFile('dist/ui.html', 'utf8')
await mkdir(OUT, { recursive: true })

for (const shot of SHOTS) {
  const page = shell.replace(
    '<div id="root"></div>',
    PIN + '<div id="root"></div>' + harness(shot),
  )
  const path = `${OUT}/${shot.name}.html`
  await writeFile(path, page)

  const raw = `${OUT}/${shot.name}-raw.png`
  await run(CHROME, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--window-size=${WINDOW.width},${WINDOW.height}`,
    `--virtual-time-budget=${shot.budget ?? 4000}`,
    `--screenshot=${raw}`,
    `file://${process.cwd()}/${path}`,
  ]).catch((error) => {
    // Chrome writes its status to stderr and exits non-zero on some builds even when
    // the screenshot succeeded, so only genuine failures are thrown.
    if (!String(error.stderr ?? '').includes('written to file')) throw error
  })

  // Crop back to the true panel size, 2x for the device scale factor.
  await run('magick', [
    raw,
    '-crop',
    `${WIDTH * 2}x${HEIGHT * 2}+0+0`,
    '+repage',
    `${OUT}/${shot.name}.png`,
  ])

  console.log(`${OUT}/${shot.name}.png`)
}
