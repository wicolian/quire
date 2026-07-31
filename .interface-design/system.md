# Quire — interface system

Decisions already made. Follow these rather than re-deriving them; where new work
conflicts, this file wins unless the conflict is a genuine improvement worth writing
down here.

## Direction

**Prepress, not SaaS.** Quire is a press tool, and the interface is a proof sheet — not
a dashboard, not a settings page. The vocabulary is imposition, signatures, gathering,
plate, stock, ink coverage. When naming something new, reach into that world first.

**The user is shipping, not exploring.** They are docked over their own artwork, seconds
after their last edit, exporting a document they have exported nine times before. The
panel's job is to confirm a known-good setup fast. Anything that makes them *read* to
proceed is a cost.

**Feel:** quiet, precise, slightly analogue. Warm rather than clinical. Nothing should
announce itself except the one thing that matters.

## Signature element — the spine

A hairline rule binds the page list down its left edge.

- A break marker **physically severs it**, so combined-versus-split is seen, not read.
- During export it **fills with ink top-down**, page by page.
- The empty state and the app icon are the same mark: gathered sheets, bound.

This is the thing that makes Quire look like Quire. New surfaces should find a way to
use it or deliberately leave it alone — never replace it with a generic progress bar or
a divider.

## Palette

From a print shop, not a design system. Token names must sound like they belong to this
product: `--stock`, `--ink`, `--rule`, `--reg`, `--blueline`, `--kraft`. If a name would
be at home in any project (`--gray-700`, `--surface-2`), it is wrong.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--stock` | `#f6f3ed` | `#191713` | Uncoated paper ground |
| `--stock-raised` | `#fbf9f5` | `#201d19` | Hover, floating panels |
| `--stock-inset` | `#efebe3` | `#131110` | Inputs, pressed segments |
| `--ink` → `--ink-4` | `#1f1b16` → `#b3aa9c` | `#f2ede4` → `#5a5348` | Four text levels, always used |
| `--rule` / `-soft` / `-strong` | rgba warm black | rgba warm white | Border progression |
| `--reg` | `#c8322a` | `#e5645a` | Registration red — the **only** accent |
| `--blueline` | `#4a6fa5` | `#7d9fd1` | Informational marks, links |
| `--kraft` | `#a8794a` | `#c39a6b` | Break markers, advisory notices |

**Press black is never `#000`.** Every neutral is warm. A cool gray anywhere in this
interface is a bug.

**`--reg` appears once per screen at most.** It is the export button, the ink in the
spine, the over-cap state, the spine in the icon. Spending it anywhere else dilutes all
four.

Theme switches on Figma's own `.figma-dark` class on `:root`, with `themeColors: true`
in the manifest. A plugin that ignores the host theme reads as broken.

## Depth

**Borders-only. No shadows, ever.** The panel floats over the user's artwork; a shadow
would compete with the thing they are actually looking at. Hierarchy comes from the
three-step rule progression and whisper-quiet surface shifts.

Squint test: structure still legible, nothing jumping out.

## Type

**Predominantly monospace**, because this UI is almost entirely data and a proof sheet
is typewritten.

- **Mono** (`--mono`, tabular figures): page numbers, frame names, dimensions, DPI, byte
  counts, filenames, all metadata lines. `font-variant-numeric: tabular-nums` is
  non-negotiable — columns must not shift as values change.
- **Sans** (`--sans`): control labels, prose, buttons, empty-state copy.

Inter as the primary UI face would be the default here. It is not what a press tool
looks like.

## Spacing & shape

Base unit **4px**. Row height **30px**. Radius: `3px` controls, `5px` buttons/cards.
Sharper than typical — this is a technical tool.

## Component patterns

**Outcome buttons.** The primary action states the *result*, not the verb:
`Export 3 PDFs · ~4.2 MB`. Never make the user press something to find out what it does.

**Segmented selectors over `<select>`.** Four options that constitute the actual
decision belong on screen. Native selects also render unstyleable OS menus.

**The ink gauge.** Coverage against a cap, filling like ink on a sheet. Shows `~` while
estimated, drops it once measured. Turns `--reg` when over.

**Exclusion is strikethrough, not an unchecked box.** The user is assembling a document,
not picking files from a list. Position number is the primary affordance.

**Row actions appear on hover/focus-within**, never permanently — they would double the
visual weight of a list whose whole job is to be scannable.

**Notices are inline and specific**, carrying a mark (`⚠` `ℹ`) in `--kraft` or `--reg`
and, where there is a decision, its buttons. Never a modal, never a toast for something
the user must act on.

## States that must exist

Every data surface: loading, empty, error, over-cap. Every control: default, hover,
active, focus-visible, disabled.

Two empty states, never one: "nothing selected" and "selected thing is empty" need
different answers, and collapsing them leaves the second looking broken.

Focus rings are `--reg`, 1.5px, offset 1px. Keyboard users are not an afterthought in a
tool used this repetitively.

## Copy

Plain, specific, no exclamation marks. State real numbers:
*"9.1 MB — still over 8 MB"*, not *"File too large"*. Name the thing that failed:
*"11 of 12 pages exported. D2-06 failed."*

Never claim something happened that did not. Never degrade output silently — if the tool
is about to do something lossy, it says so and waits.
