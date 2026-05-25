// ProviderMultiSelect — provider filter chips (LLD Tasks 90-91).
//
// The four supported providers are a fixed, known set (this is NOT a model
// catalog — the "never hardcode" rule applies to models, which DO come from
// the availability snapshot via ProviderModelPicker).

'use client';

import { MultiSelectChips } from './MultiSelectChips';

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'mock', label: 'Mock' },
] as const;

export type ProviderMultiSelectProps = {
  selected: string[];
  onChange: (next: string[]) => void;
};

export function ProviderMultiSelect({ selected, onChange }: ProviderMultiSelectProps) {
  return (
    <MultiSelectChips
      testIdPrefix="console-filter-provider"
      groupLabel="Provider"
      options={PROVIDER_OPTIONS}
      selected={selected}
      onChange={onChange}
    />
  );
}
