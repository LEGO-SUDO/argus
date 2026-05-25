// FreeTextSearchInput — debounced free-text search box, reskinned to
// .con-search (REVIEW-BRIEF Finding 4, LLD Tasks 98-99).
//
// Emits the TRIMMED query to `onChange` exactly once at the debounce boundary.
// The wrapper renders as .con-search (inline in the .con-tools bar) instead of
// the previous card panel.

'use client';

import { useState } from 'react';

import { useDebouncedCallback } from '@/lib/use-debounced-callback';
import { Icon } from '../Icon';

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
    <div className="con-search">
      <Icon name="search" size={12} aria-hidden="true" />
      <label htmlFor="console-traces-search" className="sr-only">
        Search traces
      </label>
      <input
        id="console-traces-search"
        type="search"
        data-testid="console-filter-search-input"
        aria-label="Search traces"
        placeholder="search input previews…"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          emit(next.trim());
        }}
      />
    </div>
  );
}
