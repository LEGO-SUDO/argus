// ModelMultiSelect — model filter chips over a prop-supplied model list
// (LLD Tasks 92-93). The model list is supplied by the parent (derived from
// loaded rows / availability), never hardcoded here.

'use client';

import { MultiSelectChips } from './MultiSelectChips';

export type ModelMultiSelectProps = {
  models: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export function ModelMultiSelect({ models, selected, onChange }: ModelMultiSelectProps) {
  return (
    <MultiSelectChips
      testIdPrefix="console-filter-model"
      groupLabel="Model"
      options={models.map((m) => ({ value: m, label: m }))}
      selected={selected}
      onChange={onChange}
    />
  );
}
