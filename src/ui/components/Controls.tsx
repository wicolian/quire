import { useState } from 'preact/hooks'
import { STOCKS, STOCK_ORDER, parseMegabytes, resolveParams } from '../../core/budget'
import { formatBytes } from '../../core/naming'
import type { ExportSettings, StockId } from '../../core/types'

/**
 * The controls.
 *
 * Ordered by what the decision is about: Output settles *what files you get*, Stock
 * settles *how big they are*, Advanced is for the rare case where a specific file needs
 * fighting. Output used to sit below Advanced, which buried the more consequential
 * choice under the less consequential one.
 *
 * Both selectors are the same segmented control, because they are the same kind of
 * decision — a small closed set where hiding the options behind a dropdown would cost
 * more than showing them.
 */

export interface ControlsProps {
  settings: ExportSettings
  estimatedBytes: number
  /** Set once an export has run, replacing the estimate with the truth. */
  measuredBytes: number | null
  onChange: (settings: ExportSettings) => void
  busy: boolean
}

export function Controls({ settings, estimatedBytes, measuredBytes, onChange, busy }: ControlsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const params = resolveParams(settings)
  const bytes = measuredBytes ?? estimatedBytes
  const cap = params.capBytes

  const ratio = cap ? Math.min(1.35, bytes / cap) : Math.min(1, bytes / (20 * 1024 * 1024))
  const over = cap !== null && bytes > cap

  function patch(next: Partial<ExportSettings>) {
    onChange({ ...settings, ...next })
  }

  return (
    <div class="controls">
      <div class="block">
        <div class="label">Output</div>
        <div class="segmented" role="group" aria-label="Output mode">
          <button
            class="segment"
            aria-pressed={settings.output === 'combined'}
            disabled={busy}
            onClick={() => patch({ output: 'combined' })}
          >
            Combined
          </button>
          <button
            class="segment"
            aria-pressed={settings.output === 'split'}
            disabled={busy}
            onClick={() => patch({ output: 'split' })}
            title="One PDF per page"
          >
            Split
          </button>
        </div>
      </div>

      <div class="block">
        <div class="label">Stock</div>
        <div class="segmented" role="group" aria-label="Quality preset">
          {STOCK_ORDER.map((id: StockId) => (
            <button
              key={id}
              class="segment"
              aria-pressed={settings.stock === id}
              disabled={busy}
              onClick={() => patch({ stock: id })}
            >
              {STOCKS[id].label}
            </button>
          ))}
        </div>

        {settings.stock === 'custom' && (
          <div class="limit-row">
            <span>Size limit</span>
            <input
              class="text-input"
              type="text"
              inputMode="decimal"
              placeholder="8"
              aria-label="Size limit in megabytes"
              disabled={busy}
              value={settings.customCapBytes ? (settings.customCapBytes / (1024 * 1024)).toString() : ''}
              onInput={(event) =>
                patch({ customCapBytes: parseMegabytes((event.target as HTMLInputElement).value) })
              }
            />
            <span>MB</span>
          </div>
        )}

        <div class="gauge">
          <div class="gauge-track">
            <div
              class={`gauge-fill${over ? ' over' : ''}`}
              style={{ width: `${Math.min(100, ratio * 100)}%` }}
            />
          </div>
          <div class={`gauge-figure${over ? ' over' : ''}`}>
            {measuredBytes === null && '~'}
            {formatBytes(bytes)}
            {cap !== null && ` / ${formatBytes(cap)}`}
          </div>
        </div>
      </div>

      <div class="block">
        <button
          class="disclosure"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          aria-expanded={advancedOpen}
        >
          <span aria-hidden="true">{advancedOpen ? '⌄' : '›'}</span> Advanced
        </button>

        {advancedOpen && (
          <div class="advanced">
            <label class="field">
              <span>Image DPI</span>
              <input
                type="range"
                min="72"
                max="300"
                step="6"
                disabled={busy}
                value={params.dpi}
                onInput={(event) =>
                  patch({ dpiOverride: Number((event.target as HTMLInputElement).value) })
                }
              />
              <span class="field-value">{params.dpi}</span>
            </label>

            <label class="field">
              <span>JPEG quality</span>
              <input
                type="range"
                min="40"
                max="98"
                step="1"
                disabled={busy}
                value={Math.round(params.quality * 100)}
                onInput={(event) =>
                  patch({ qualityOverride: Number((event.target as HTMLInputElement).value) / 100 })
                }
              />
              <span class="field-value">{Math.round(params.quality * 100)}</span>
            </label>

            <label class="checkbox">
              <input
                type="checkbox"
                disabled={busy}
                checked={settings.skipSmallImages}
                onChange={(event) =>
                  patch({ skipSmallImages: (event.target as HTMLInputElement).checked })
                }
              />
              Skip images already under the target DPI
            </label>

            <label class="checkbox">
              <input
                type="checkbox"
                disabled={busy}
                checked={settings.bookmarks}
                onChange={(event) => patch({ bookmarks: (event.target as HTMLInputElement).checked })}
              />
              Add PDF bookmarks from frame names
            </label>

            {(settings.dpiOverride !== null || settings.qualityOverride !== null) && (
              <button
                class="link"
                style={{ justifySelf: 'start' }}
                onClick={() => patch({ dpiOverride: null, qualityOverride: null })}
              >
                Reset to {STOCKS[settings.stock].label} defaults
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
