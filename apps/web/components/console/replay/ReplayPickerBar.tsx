// ReplayPickerBar — the `.replay-picker` toolbar at the top of the Replay tab.
//
// Reskinned to the dev-tool design language (REVIEW-BRIEF Finding 4).
// Renders:
//   - "source" label + `.source` chip (status pill + ptag + input preview)
//     which opens the SourceMenu dropdown (candidate list)
//   - `.arrow` separator icon
//   - "replay against" label + `.target-pick` provider buttons (with swatch,
//     `.active`/`.unavailable`) + model select
//   - `.run-btn` (spinner while running) + ResetToOriginalButton (ghost)
//
// When no source is selected yet, renders only the SourceMenu list so the user
// can pick a candidate (mirrors the existing no-source ReplayPicker behaviour).
//
// All pre-existing data-testids and ARIA attributes are preserved.

'use client';

import { useState } from 'react';

import type { ProviderAvailabilityResponse, ReplayCandidate, TimeWindow } from '@argus/contracts';

import { Icon } from '@/components/console/Icon';
import { ReplayPicker } from './ReplayPicker';
import { RunReplayButton } from './RunReplayButton';
import { ResetToOriginalButton } from './ResetToOriginalButton';
import type { ReplaySource } from './ReplayDetail';

// --------------------------------------------------------------------------
// Status pill — mirrors prototype StatusPill using CSS `.pill` classes
// --------------------------------------------------------------------------
const PILL_CLASS: Record<string, string> = {
  ok: 'pill ok',
  failed: 'pill err',
  timed_out: 'pill warn',
  canceled: 'pill cancel',
  streaming: 'pill streaming',
};

function StatusPill({ status }: { status: string }) {
  const cls = PILL_CLASS[status] ?? 'pill';
  return (
    <span
      data-testid={`console-replay-status-pill-${status}`}
      className={cls}
      aria-label={`Status: ${status}`}
    >
      <span className="pdot" aria-hidden="true" />
      {status}
    </span>
  );
}

// --------------------------------------------------------------------------
// SourceMenu — dropdown listing eligible candidates (mirrors prototype)
// --------------------------------------------------------------------------
type SourceMenuProps = {
  source: ReplaySource;
  candidates: ReplayCandidate[];
  window: TimeWindow;
  onPick: (candidate: ReplayCandidate) => void;
};

function SourceMenu({ source, candidates, window, onPick }: SourceMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="console-replay-source-chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Selected source: ${source.provider} ${source.model}, status ${source.status}`}
        className="source"
        onClick={() => setOpen((o) => !o)}
      >
        <StatusPill status={source.status} />
        <span
          className="ptag"
          data-prov={source.provider}
          aria-hidden="true"
        >
          <span className="swatch" />
          {source.provider}
        </span>
        <span
          style={{
            color: 'var(--con-dim)',
            maxWidth: 240,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          &ldquo;{source.inputPreview ?? '—'}&rdquo;
        </span>
        <Icon name="arrow-down-right" size={10} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Backdrop closes the menu */}
          <div
            data-testid="console-replay-source-menu-backdrop"
            style={{ position: 'fixed', inset: 0, zIndex: 19 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Candidate list */}
          <div
            data-testid="console-replay-source-menu"
            role="listbox"
            aria-label="Pick a replay source"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              width: 460,
              maxHeight: 340,
              overflow: 'auto',
              background: 'var(--con-panel)',
              border: '1px solid var(--con-rule)',
              borderRadius: 6,
              padding: 6,
              zIndex: 20,
              boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            }}
          >
            <ReplayPicker
              candidates={candidates}
              window={window}
              onSelect={(c) => {
                onPick(c);
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// ReplayPickerBar props
// --------------------------------------------------------------------------
export type ReplayPickerBarProps = {
  candidates: ReplayCandidate[];
  window: TimeWindow;
  onSelect: (candidate: ReplayCandidate) => void;
  // Only present when a source has been selected:
  source?: ReplaySource;
  availability?: ProviderAvailabilityResponse;
  provider?: string;
  model?: string;
  onProviderModelChange?: (provider: string, model: string) => void;
  onRun?: () => void;
  onReset?: () => void;
  running?: boolean;
};

// --------------------------------------------------------------------------
// ReplayPickerBar
// --------------------------------------------------------------------------
export function ReplayPickerBar({
  candidates,
  window,
  onSelect,
  source,
  availability,
  provider = '',
  model = '',
  onProviderModelChange,
  onRun,
  onReset,
  running = false,
}: ReplayPickerBarProps) {
  // No source selected yet — fall through to the plain list.
  if (!source || !availability) {
    return (
      <div data-testid="console-replay-picker-bar" className="replay-picker">
        <span className="lab">pick a source</span>
        <ReplayPicker candidates={candidates} window={window} onSelect={onSelect} />
      </div>
    );
  }

  // Helper: select a provider, auto-picking its first model.
  const selectProvider = (nextProvider: string) => {
    const target = availability.providers.find((p) => p.provider === nextProvider);
    const firstModel = target?.models[0]?.model ?? '';
    onProviderModelChange?.(nextProvider, firstModel);
  };

  return (
    <div
      data-testid="console-replay-picker-bar"
      className="replay-picker"
      role="toolbar"
      aria-label="Replay controls"
    >
      {/* Source chip + dropdown */}
      <span className="lab" aria-hidden="true">source</span>
      <SourceMenu
        source={source}
        candidates={candidates}
        window={window}
        onPick={onSelect}
      />

      {/* Arrow separator */}
      <span className="arrow" aria-hidden="true">
        <Icon name="arrow-right" size={12} />
      </span>

      {/* "replay against" label */}
      <span className="lab" aria-hidden="true">replay against</span>

      {/* Provider toggle buttons */}
      <div
        className="target-pick"
        role="group"
        aria-label="Target provider"
        data-testid="console-replay-target-pick"
      >
        {availability.providers.map((p) => {
          const unavailable = !p.available;
          const selected = p.provider === provider;
          return (
            <button
              key={p.provider}
              type="button"
              data-testid={`console-replay-provider-${p.provider}`}
              aria-pressed={selected}
              aria-disabled={unavailable}
              disabled={unavailable}
              aria-label={`Provider ${p.provider}${unavailable ? ' (not configured — will fall back to mock)' : ''}`}
              title={unavailable ? 'not configured — will fall back to mock' : undefined}
              className={[
                selected ? 'active' : '',
                unavailable ? 'unavailable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                if (!unavailable) selectProvider(p.provider);
              }}
            >
              {/* Provider colour swatch */}
              <span
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: `var(--p-${p.provider})`,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              {p.provider}
              {p.provider === source.provider && (
                <span
                  style={{ color: 'var(--con-dim-2)', marginLeft: 4, fontSize: 9.5 }}
                  aria-label="(original provider)"
                >
                  (orig)
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Model select — inline alongside the provider toggle */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="console-replay-model"
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--con-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          model
        </label>
        <select
          id="console-replay-model"
          data-testid="console-replay-model-select"
          aria-label="Replay model"
          value={model}
          onChange={(e) => onProviderModelChange?.(provider, e.target.value)}
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 11.5,
            background: 'var(--con-panel)',
            border: '1px solid var(--con-rule)',
            borderRadius: 4,
            color: 'var(--con-text)',
            padding: '4px 8px',
          }}
        >
          {(availability.providers.find((p) => p.provider === provider)?.models ?? []).length ===
            0 && <option value="">No models</option>}
          {(availability.providers.find((p) => p.provider === provider)?.models ?? []).map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
              {m.priced ? '' : ' (unpriced)'}
            </option>
          ))}
        </select>
      </div>

      {/* Reset + Run — pushed to the right via `margin-left: auto` on run-btn */}
      {onReset && (
        <ResetToOriginalButton onReset={onReset} disabled={running} />
      )}
      {onRun && (
        <RunReplayButton
          onRun={onRun}
          running={running}
          className="run-btn"
        />
      )}
    </div>
  );
}
