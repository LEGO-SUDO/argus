// FreeTextSearchInput — debounced free-text search box (LLD Tasks 98-99).
//
// Emits the TRIMMED query to `onChange` exactly once at the debounce boundary
// (via use-debounced-callback), so a fast typist does not trigger a refetch per
// keystroke. Clearing the input emits an empty string.

'use client';

import { useState } from 'react';

import { useDebouncedCallback } from '@/lib/use-debounced-callback';

export type FreeTextSearchInputProps = {
  initialValue?: string;
  onChange: (query: string) => void;
  debounceMs?: number;
};

export function FreeTextSearchInput({
  initialValue = '',
  onChange,
  debounceMs = 300,
}: FreeTextSearchInputProps) {
  const [text, setText] = useState(initialValue);
  const emit = useDebouncedCallback((query: string) => onChange(query), debounceMs);

  return (
    <div className="relative">
      <label htmlFor="console-traces-search" className="sr-only">
        Search traces
      </label>
      <input
        id="console-traces-search"
        type="search"
        data-testid="console-filter-search-input"
        aria-label="Search traces"
        placeholder="Search prompts / responses…"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          emit(next.trim());
        }}
        className="min-h-9 w-full rounded-[6px] border border-chat-rule bg-chat-bg px-2.5 py-1.5 text-[13px] text-chat-ink placeholder:text-chat-ink-3 outline-none focus:border-acc focus-visible:ring-2 focus-visible:ring-acc"
      />
    </div>
  );
}
