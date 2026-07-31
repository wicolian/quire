/**
 * Filenames. These land in the user's Downloads folder next to everything else they
 * have, so they need to be readable, safe on every OS, and never silently collide.
 */

/** Punctuation no major filesystem tolerates. */
const UNSAFE_PUNCT = /[\\/:*?"<>|]/g

/**
 * Dash-like code points that show up in document names: the various hyphens, figure
 * dash, en dash, em dash, horizontal bar and minus sign.
 *
 * Listed as code points rather than as literal characters in a character class. A
 * class of visually near-identical dashes is unreadable, and one careless edit turns
 * it into an out-of-order range that fails to compile, which is exactly what happened.
 */
const FANCY_DASHES = new Set([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212])

function normalizeDashes(input: string): string {
  let out = ''
  for (const char of input) {
    out += FANCY_DASHES.has(char.codePointAt(0)!) ? '-' : char
  }
  return out
}

/** Windows refuses these as filenames regardless of extension. */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/** Drop control characters without embedding literal control bytes in this source. */
function stripControlChars(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) continue
    out += char
  }
  return out
}

/**
 * Turn a Figma layer name into a filename stem.
 *
 * Long dashes are common in document names and are legal in
 * filenames, but they travel badly through email and URLs, so they collapse to
 * hyphens along with whitespace.
 */
export function sanitizeStem(name: string, fallback = 'Untitled'): string {
  let stem = normalizeDashes(stripControlChars(name.normalize('NFC')))
    .replace(UNSAFE_PUNCT, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .trim()

  if (RESERVED.has(stem.toLowerCase())) stem = `${stem}-file`

  // Leave headroom for a collision suffix and the extension.
  if (stem.length > 100) stem = stem.slice(0, 100).replace(/-+$/, '')

  return stem || fallback
}

/**
 * Assign unique filenames to a list of stems.
 *
 * Collisions are real here: splitting per page in a document with two frames both
 * named "Cover" would otherwise write one file and silently lose the other.
 */
export function uniqueFilenames(stems: string[], extension = 'pdf'): string[] {
  const used = new Map<string, number>()
  return stems.map((raw) => {
    const stem = sanitizeStem(raw)
    const key = stem.toLowerCase()
    const seen = used.get(key) ?? 0
    used.set(key, seen + 1)
    return seen === 0 ? `${stem}.${extension}` : `${stem}-${seen + 1}.${extension}`
  })
}

/**
 * Name the output files for one document.
 *
 * A single group keeps the document's own name. Multiple groups get a numeric prefix
 * plus the first page's name, so `Doc-2_2-Introduction.pdf` tells you both which
 * document it came from and where it starts.
 */
export function outputFilenames(
  docName: string,
  groups: { name: string }[][],
  mode: 'combined' | 'split',
): string[] {
  const doc = sanitizeStem(docName, 'Document')

  if (mode === 'split') {
    return uniqueFilenames(groups.flat().map((p) => p.name))
  }
  if (groups.length === 1) {
    return [`${doc}.pdf`]
  }
  return uniqueFilenames(
    groups.map((group, index) => `${doc}_${index + 1}-${sanitizeStem(group[0]?.name ?? '')}`),
  )
}

/** Human-readable byte counts. Uses MB/KB because that is what file size limits use. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
