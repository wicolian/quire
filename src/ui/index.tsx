import { render } from 'preact'
import { App } from './app'
import styles from './styles.css'

// esbuild inlines the stylesheet as text; Figma serves ui.html as a single document,
// so there is no second request that could fetch it.
const sheet = document.createElement('style')
sheet.textContent = styles
document.head.appendChild(sheet)

const root = document.getElementById('root')
if (root) render(<App />, root)
