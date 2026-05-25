// ConversationMultiSelect — conversation filter chips over a prop-supplied
// conversation list (LLD Tasks 96-97). Each chip shows the conversation title
// and emits the selected conversation ids.

'use client';

import { MultiSelectChips } from './MultiSelectChips';

export type ConversationOption = { id: string; title: string };

export type ConversationMultiSelectProps = {
  conversations: ConversationOption[];
  selected: string[];
  onChange: (next: string[]) => void;
};

export function ConversationMultiSelect({
  conversations,
  selected,
  onChange,
}: ConversationMultiSelectProps) {
  return (
    <MultiSelectChips
      testIdPrefix="console-filter-conversation"
      groupLabel="Conversation"
      options={conversations.map((c) => ({ value: c.id, label: c.title }))}
      selected={selected}
      onChange={onChange}
    />
  );
}
