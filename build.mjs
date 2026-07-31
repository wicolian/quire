import * as esbuild from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

const watch = process.argv.includes('--watch')

await mkdir('dist', { recursive: true })

/** The sandbox realm: no DOM, no bundled UI libs. */
const mainConfig = {
  entryPoints: ['src/main/index.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/main.js',
  logLevel: 'info',
}

/**
 * The UI realm. Figma serves ui.html as a single inlined document, so the JS and CSS
 * have to end up inside it, there is no second request we could make for them.
 */
const uiConfig = {
  entryPoints: ['src/ui/index.tsx'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: 'dist/ui.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  logLevel: 'info',
  minify: !watch,
}

async function inlineHtml() {
  const [shell, js] = await Promise.all([
    readFile('src/ui/ui.html', 'utf8'),
    readFile('dist/ui.js', 'utf8'),
  ])
  await writeFile(
    'dist/ui.html',
    shell.replace('<!--SCRIPT-->', `<script>${js}</script>`),
  )
}

if (watch) {
  const inlinePlugin = {
    name: 'inline-html',
    setup(build) {
      build.onEnd(inlineHtml)
    },
  }
  const [mainCtx, uiCtx] = await Promise.all([
    esbuild.context(mainConfig),
    esbuild.context({ ...uiConfig, plugins: [inlinePlugin] }),
  ])
  await Promise.all([mainCtx.watch(), uiCtx.watch()])
  console.log('watching…')
} else {
  await Promise.all([esbuild.build(mainConfig), esbuild.build(uiConfig)])
  await inlineHtml()
  console.log('built dist/main.js and dist/ui.html')
}
