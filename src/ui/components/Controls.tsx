import { useState } from 'preact/hooks'
import { STOCKS, STOCK_ORDER, parseMegabytes, resolveParams } from '../../core/budget'
import { formatBytes } from '../../core/naming'
import type { ExportSettings, StockId } from '../../core/types'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

/**
 * The controls.
 *
 * Ordered by what the decision is about: Output settles *what files you get*, Stock
 * settles *how big they are*, Advanced is for the rare case where a specific file needs
 * fighting. Output used to sit below Advanced, which buried the more consequential
 * choice under the less consequential one.
 *
 * Both selectors are the same segmented control, because they are the same kind of
 * decision, a small closed set where hiding the options behind a dropdown would cost
 * more than showing them.
 */

export interface ControlsProps {
  settings: ExportSettings
  estimatedBytes: number
  /** Set once an export has run, replacing the estimate with the truth. */
  measuredBytes: number | null
  onChange: (settings: ExportSettings) => void
  busy: boolean
  /** Panel text size. Applied at the document root, so it scales icons too. */
  uiScale: number
  onUiScaleChange: (scale: number) => void
}

export function Controls({
  settings,
  estimatedBytes,
  measuredBytes,
  onChange,
  busy,
  uiScale,
  onUiScaleChange,
}: ControlsProps) {
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
        <Segmented
          label="Output mode"
          disabled={busy}
          value={settings.output}
          onChange={(output) => patch({ output })}
          options={[
            { value: 'combined', label: 'Combined', title: 'One PDF, split at break markers' },
            { value: 'split', label: 'Split', title: 'One PDF per page' },
          ]}
        />
      </div>

      <div class="block">
        <div class="label">Stock</div>
        <Segmented
          label="Quality preset"
          disabled={busy}
          value={settings.stock}
          onChange={(stock) => patch({ stock })}
          options={STOCK_ORDER.map((id: StockId) => ({ value: id, label: STOCKS[id].label }))}
        />

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
          <span class="disclosure-chevron">
            <Icon name="chevron" size={0.9} />
          </span>
          Advanced
        </button>

        {/* Kept mounted rather than conditionally rendered, so it animates closed as
            well as open. Hidden from focus and assistive tech via CSS visibility. */}
        <div class={`drawer${advancedOpen ? ' open' : ''}`} aria-hidden={!advancedOpen}>
          <div class="drawer-inner">
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

              <div class="field">
                <span>Text size</span>
                <Segmented
                  label="Panel text size"
                  value={String(uiScale)}
                  onChange={(value) => onUiScaleChange(Number(value))}
                  options={[
                    { value: '0.9', label: 'S', title: 'Small' },
                    { value: '1', label: 'M', title: 'Default' },
                    { value: '1.15', label: 'L', title: 'Large' },
                  ]}
                />
                <span class="field-value" />
              </div>

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
          </div>
        </div>
      </div>
    </div>
  )
}
