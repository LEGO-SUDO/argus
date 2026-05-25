// ProviderModelPicker — provider + model selectors for replay (LLD Tasks
// 154-157).
//
// The provider list + per-provider model catalog come ENTIRELY from the
// availability payload (ProviderAvailabilityResponse) — the frontend never
// hardcodes a model list. Unavailable providers are disabled with a "key not
// configured" tooltip and an inline "switch to Mock" CTA. Switching the
// provider re-renders the model dropdown with that provider's models.

'use client';

import type { ProviderAvailabilityResponse } from '@argus/contracts';

export type ProviderModelPickerProps = {
  availability: ProviderAvailabilityResponse;
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
};

export function ProviderModelPicker({
  availability,
  provider,
  model,
  onChange,
}: ProviderModelPickerProps) {
  const current = availability.providers.find((p) => p.provider === provider);
  const models = current?.models ?? [];
  const mockProvider = availability.providers.find((p) => p.provider === 'mock');

  const selectProvider = (nextProvider: string) => {
    const target = availability.providers.find((p) => p.provider === nextProvider);
    const firstModel = target?.models[0]?.model ?? '';
    onChange(nextProvider, firstModel);
  };

  return (
    <div data-testid="console-replay-provider-model-picker" className="flex flex-col gap-2">
      <div role="group" aria-label="Provider" className="flex flex-wrap items-center gap-2">
        {availability.providers.map((p) => {
          const unavailable = !p.available;
          const selected = p.provider === provider;
          return (
            <span key={p.provider} className="inline-flex items-center gap-1">
              <button
                type="button"
                data-testid={`console-replay-provider-${p.provider}`}
                aria-pressed={selected}
                aria-disabled={unavailable}
                disabled={unavailable}
                aria-label={`Provider ${p.provider}${unavailable ? ' (key not configured)' : ''}`}
                title={unavailable ? 'key not configured' : undefined}
                onClick={() => {
                  if (!unavailable) selectProvider(p.provider);
                }}
                className={`min-h-8 rounded-full border px-2.5 py-1 text-[11.5px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
                  unavailable
                    ? 'cursor-not-allowed border-chat-rule text-chat-ink-3'
                    : selected
                      ? 'border-acc bg-acc-soft text-chat-ink'
                      : 'border-chat-rule text-chat-ink-2 hover:bg-chat-hover'
                }`}
              >
                {p.provider}
              </button>
              {unavailable && mockProvider && (
                <button
                  type="button"
                  data-testid={`console-replay-switch-mock-${p.provider}`}
                  aria-label="Switch to Mock provider"
                  onClick={() => selectProvider('mock')}
                  className="text-[11px] text-acc-strong underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
                >
                  switch to Mock
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="console-replay-model" className="text-[12px] text-chat-ink-2">
          Model
        </label>
        <select
          id="console-replay-model"
          data-testid="console-replay-model-select"
          aria-label="Replay model"
          value={model}
          onChange={(e) => onChange(provider, e.target.value)}
          className="min-h-8 rounded-[6px] border border-chat-rule bg-chat-bg px-2 py-1 text-[12.5px] text-chat-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
        >
          {models.length === 0 && <option value="">No models</option>}
          {models.map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
              {m.priced ? '' : ' (unpriced)'}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
