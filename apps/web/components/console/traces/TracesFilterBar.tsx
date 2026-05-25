// TracesFilterBar — inline filter row reskinned to the .con-tools design
// language (REVIEW-BRIEF Finding 4, LLD Tasks 102-105).
//
// Previously a card panel; now a thin toolbar (flex row) that lives INSIDE
// .con-tools. The parent TracesTab owns the .con-tools wrapper and also renders
// the window-switch alongside this bar, so this component renders only its
// portion: the multi-select triggers + search + spacer + clear-all.
//
// All behaviour is unchanged: controlled, AND-combined filter, clear-all emits
// the empty filter. All data-testids are preserved.

'use client';

import type { InferenceStatus } from '@argus/contracts';
import { emptyTracesFilter, type TracesFilter } from '@/lib/traces-filter-encoding';

import { ProviderMultiSelect } from './ProviderMultiSelect';
import { ModelMultiSelect } from './ModelMultiSelect';
import { StatusMultiSelect } from './StatusMultiSelect';
import { ConversationMultiSelect, type ConversationOption } from './ConversationMultiSelect';
import { FreeTextSearchInput } from './FreeTextSearchInput';
import { ClearAllFiltersButton } from './ClearAllFiltersButton';

export type TracesFilterBarProps = {
  value: TracesFilter;
  onChange: (next: TracesFilter) => void;
  models: string[];
  conversations: ConversationOption[];
  searchDebounceMs?: number;
};

export function TracesFilterBar({
  value,
  onChange,
  models,
  conversations,
  searchDebounceMs,
}: TracesFilterBarProps) {
  const patch = (partial: Partial<TracesFilter>) => onChange({ ...value, ...partial });

  return (
    <>
      <ProviderMultiSelect
        selected={value.provider}
        onChange={(provider) => patch({ provider })}
      />
      <ModelMultiSelect
        models={models}
        selected={value.model}
        onChange={(model) => patch({ model })}
      />
      <StatusMultiSelect
        selected={value.status}
        onChange={(status: InferenceStatus[]) => patch({ status })}
      />
      <ConversationMultiSelect
        conversations={conversations}
        selected={value.conversationId}
        onChange={(conversationId) => patch({ conversationId })}
      />
      <FreeTextSearchInput
        initialValue={value.search}
        debounceMs={searchDebounceMs}
        onChange={(search) => patch({ search })}
      />
      <div
        className="spacer"
        role="presentation"
        aria-hidden="true"
        data-testid="console-traces-filter-bar"
      />
      <ClearAllFiltersButton onClear={() => onChange(emptyTracesFilter())} />
    </>
  );
}
