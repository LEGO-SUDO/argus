// TracesFilterBar — composes the five filter sub-controls + clear-all and
// emits a single AND-combined TracesFilter on any sub-change (LLD Tasks 102-105).
//
// Controlled: the parent owns the `value`; each sub-control change merges into
// the current value and emits the combined object. Clear-all emits the empty
// filter (which, because the bar is controlled, also resets every sub-control).

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
    <div
      data-testid="console-traces-filter-bar"
      className="flex flex-col gap-3 rounded-md border border-chat-rule bg-chat-panel p-3"
    >
      <FreeTextSearchInput
        initialValue={value.search}
        debounceMs={searchDebounceMs}
        onChange={(search) => patch({ search })}
      />
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
      <div className="flex justify-end">
        <ClearAllFiltersButton onClear={() => onChange(emptyTracesFilter())} />
      </div>
    </div>
  );
}
