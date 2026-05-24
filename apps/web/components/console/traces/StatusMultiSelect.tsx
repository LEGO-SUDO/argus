// StatusMultiSelect — status filter chips over the InferenceStatus enum
// (LLD Tasks 94-95). Options are sourced from the contract schema so they stay
// in lockstep with the api's status set (ok | streaming | failed | canceled |
// timed_out).

'use client';

import { InferenceStatusSchema, type InferenceStatus } from '@argus/contracts';
import { MultiSelectChips } from './MultiSelectChips';

const STATUS_LABELS: Record<InferenceStatus, string> = {
  ok: 'OK',
  streaming: 'Streaming',
  failed: 'Failed',
  canceled: 'Canceled',
  timed_out: 'Timed out',
};

const STATUS_OPTIONS = InferenceStatusSchema.options.map((value) => ({
  value,
  label: STATUS_LABELS[value],
}));

export type StatusMultiSelectProps = {
  selected: InferenceStatus[];
  onChange: (next: InferenceStatus[]) => void;
};

export function StatusMultiSelect({ selected, onChange }: StatusMultiSelectProps) {
  return (
    <MultiSelectChips
      testIdPrefix="console-filter-status"
      groupLabel="Status"
      options={STATUS_OPTIONS}
      selected={selected}
      onChange={onChange}
    />
  );
}
