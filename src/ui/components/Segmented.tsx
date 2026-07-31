/**
 * A segmented selector with a selection that slides.
 *
 * Shared by Output and Stock so the two read as the same kind of decision. The sliding
 * block replaces one background switching off while another switches on. The movement
 * carries the relationship between old and new choice, which a crossfade cannot.
 *
 * Segments are equal width, so the indicator offset is just the selected index. That
 * only holds while every option is present, which is why the indicator is hidden rather
 * than mispositioned when nothing matches.
 */

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled,
  label,
}: SegmentedProps<T>) {
  const index = options.findIndex((option) => option.value === value)

  return (
    <div
      class="segmented"
      role="group"
      aria-label={label}
      // Strings, because these reach the element through style.setProperty.
      style={{ '--count': String(options.length), '--index': String(Math.max(0, index)) }}
    >
      {index >= 0 && <div class="segmented-indicator" aria-hidden="true" />}

      {options.map((option) => (
        <button
          key={option.value}
          class="segment"
          aria-pressed={option.value === value}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
