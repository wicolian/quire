/**
 * The icon set.
 *
 * Drawn rather than borrowed from a font, because the panel previously used text
 * glyphs and those brought their own metrics, their own weight and their own baseline
 * quirks. A scissors from one font and an arrow from another never look like they
 * belong to the same tool.
 *
 * House rules, so a new icon fits without thinking:
 *   14px grid, 1.25 stroke, round caps and joins, currentColor, no fills.
 *   Hairline and precise, the way a drafting instrument leaves a line.
 *
 * Size is expressed in em, so every icon scales with the text around it. That is what
 * lets the whole panel respond to the text size control without a second scale system.
 */

import type { JSX } from 'preact'

export type IconName =
  | 'grip'
  | 'cut'
  | 'include'
  | 'exclude'
  | 'refresh'
  | 'chevron'
  | 'close'
  | 'reverse'
  | 'warn'
  | 'info'
  | 'resize'
  | 'spine'

export interface IconProps {
  name: IconName
  /** Multiples of the current font size. 1 keeps the icon at cap height. */
  size?: number
  title?: string
}

const PATHS: Record<IconName, JSX.Element> = {
  // Reorder handle. Horizontal strokes read as "grab and move vertically", which is
  // the only direction this list moves in.
  grip: (
    <>
      <path d="M4.5 5h5M4.5 7h5M4.5 9h5" />
    </>
  ),

  // Scissors. The blades cross below the bows, which is what makes it read as a cut
  // rather than as an X.
  cut: (
    <>
      <path d="M4 3l6 6.5M10 3l-6 6.5" />
      <path d="M3.6 11.4a1.4 1.4 0 1 0 .8-2.4 1.4 1.4 0 0 0-.8 2.4Z" />
      <path d="M10.4 11.4a1.4 1.4 0 1 1-.8-2.4 1.4 1.4 0 0 1 .8 2.4Z" />
    </>
  ),

  include: <path d="M7 3.5v7M3.5 7h7" />,

  exclude: <path d="M3.5 7h7" />,

  // Reload. Open arc with a head, so it does not read as a full ring.
  refresh: (
    <>
      <path d="M11.5 7a4.5 4.5 0 1 1-1.6-3.45" />
      <path d="M11.7 2.2v2.6H9.1" />
    </>
  ),

  chevron: <path d="M5.5 3.5L9 7l-3.5 3.5" />,

  close: <path d="M4 4l6 6M10 4l-6 6" />,

  // Reverse the order: one arrow up, one down.
  reverse: (
    <>
      <path d="M4.5 9.5V3.5M2.6 5.4l1.9-1.9 1.9 1.9" />
      <path d="M9.5 4.5v6M11.4 8.6l-1.9 1.9-1.9-1.9" />
    </>
  ),

  warn: (
    <>
      <path d="M7 2.6 12.2 11.4H1.8L7 2.6Z" />
      <path d="M7 6v2.2" />
      <path d="M7 10.1v.01" />
    </>
  ),

  info: (
    <>
      <path d="M7 12.2A5.2 5.2 0 1 0 7 1.8a5.2 5.2 0 0 0 0 10.4Z" />
      <path d="M7 6.4v3.2" />
      <path d="M7 4.4v.01" />
    </>
  ),

  // Resize grip for the panel corner: stacked diagonals, shortest at the outside.
  resize: (
    <>
      <path d="M11 5.5 5.5 11M11 9.2 9.2 11" />
    </>
  ),

  // The mark: gathered sheets bound at the spine. Same idea as the app icon.
  spine: (
    <>
      <path d="M2.5 2.2v9.6" stroke-width="1.9" />
      <path d="M5.6 3.2v7.6M8.4 2.6v8.8M11.3 3.6v6.8" opacity="0.45" />
    </>
  ),
}

export function Icon({ name, size = 1, title }: IconProps) {
  return (
    <svg
      class="icon"
      viewBox="0 0 14 14"
      width={`${size}em`}
      height={`${size}em`}
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : 'true'}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  )
}
