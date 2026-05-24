// ProviderPicker — model selector following the WAI-ARIA 1.2 combobox-with-
// listbox pattern (LLD Block G, Tasks 99-118).
//
// Trigger: a <button role="combobox"> whose aria-expanded reflects open
// state. Dropdown panel: role="listbox". Each model row: role="option".
//
// Keyboard:
//   - ArrowDown on the focused trigger opens the dropdown and focuses the
//     first option.
//   - ArrowUp/ArrowDown on an option move focus to the previous/next option,
//     wrapping at the boundaries.
//   - Enter on a focused option selects it (onPin / onClear) and closes.
//   - Escape closes the dropdown and returns focus to the trigger.
//   - Outside-click closes the dropdown without selection.
//
// States:
//   - Auto (no pin): trigger label "Auto"; the dropdown omits an Auto row.
//   - Pinned: trigger shows "<provider> · <model>" when the pair is in the
//     catalog; a stale pin (pair absent) falls back to "Auto". When pinned,
//     the dropdown includes a leading "Auto" option that calls onClear.
//   - Streaming: trigger aria-disabled, does not open.
//   - Empty catalog: trigger shows the locked env-var copy, aria-disabled,
//     does not open.
//
// We implement the pattern inline with semantic elements + the documented
// handlers (no generic listbox primitive exists in this repo yet).
'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { ProviderCatalog, ProviderCatalogEntry } from '@/lib/providers-api';

const EMPTY_STATE_LABEL =
  'No providers configured — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.';

type ProviderPickerProps = {
  catalog: ProviderCatalog;
  pinnedProvider: string | null;
  pinnedModel: string | null;
  onPin: (provider: string, model: string) => void;
  onClear: () => void;
  streaming: boolean;
};

// A flat option model — one entry per catalog row, plus an optional synthetic
// "auto" option rendered first when a pin is active.
type Option =
  | { kind: 'auto' }
  | { kind: 'model'; entry: ProviderCatalogEntry };

export function ProviderPicker({
  catalog,
  pinnedProvider,
  pinnedModel,
  onPin,
  onClear,
  streaming,
}: ProviderPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Stable id linking the trigger (aria-controls) to the listbox panel.
  const listboxId = 'provider-picker-listbox';

  const isEmpty = catalog.providers.length === 0;
  const isDisabled = streaming || isEmpty;

  // Is the pinned (provider, model) pair actually present in the catalog?
  const pinIsValid = useMemo(() => {
    if (!pinnedProvider || !pinnedModel) return false;
    return catalog.providers.some(
      (p) => p.provider === pinnedProvider && p.model === pinnedModel,
    );
  }, [catalog.providers, pinnedProvider, pinnedModel]);

  // Trigger label. Empty-state copy wins; then a valid pin; else Auto.
  const triggerLabel = isEmpty
    ? EMPTY_STATE_LABEL
    : pinIsValid
      ? `${pinnedProvider} · ${pinnedModel}`
      : 'Auto';

  // Grouped catalog for rendering (provider → its model rows). Stable order
  // follows first-appearance in the catalog array.
  const groups = useMemo(() => groupByProvider(catalog.providers), [catalog.providers]);

  // Flat option list (in render order) for keyboard navigation + Enter
  // selection. The synthetic Auto option leads the list only when a pin is
  // active (so the user can switch back to Auto).
  const options = useMemo<Option[]>(() => {
    const flat: Option[] = [];
    if (pinIsValid) flat.push({ kind: 'auto' });
    for (const group of groups) {
      for (const entry of group.entries) {
        flat.push({ kind: 'model', entry });
      }
    }
    return flat;
  }, [groups, pinIsValid]);

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const openDropdown = useCallback(() => {
    if (isDisabled) return;
    setActiveIndex(0);
    setOpen(true);
  }, [isDisabled]);

  const selectOption = useCallback(
    (option: Option) => {
      if (option.kind === 'auto') {
        onClear();
      } else {
        onPin(option.entry.provider, option.entry.model);
      }
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onClear, onPin],
  );

  // Move DOM focus to the active option whenever it changes while open.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  // Outside-click closes without selection.
  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (isDisabled) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openDropdown();
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (options.length === 0) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const opt = options[activeIndex];
        if (opt) selectOption(opt);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        closeAndReturnFocus();
        break;
      }
    }
  }

  // Map a flat option index to its ref slot. We assign refs during render in
  // option order; reset the array each render so stale slots don't linger.
  optionRefs.current = [];
  let flatIndex = -1;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-disabled={isDisabled || undefined}
        // Explicit accessible name so screen readers (and the accessible-name
        // computation) get a stable label regardless of the nested span/SVG
        // structure. Mirrors the visible label.
        aria-label={triggerLabel}
        data-testid="provider-picker-trigger"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={onTriggerKeyDown}
        className={
          'inline-flex max-w-[280px] items-center gap-1.5 truncate rounded-full border border-chat-rule bg-chat-panel px-2.5 py-[3px] text-[11.5px] text-chat-ink-2 transition-colors hover:border-acc focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ' +
          (isDisabled ? 'cursor-not-allowed opacity-60' : '')
        }
      >
        <span className="truncate">{triggerLabel}</span>
        {!isEmpty ? (
          <svg
            width="9"
            height="9"
            viewBox="0 0 9 9"
            aria-hidden="true"
            fill="none"
            className="shrink-0"
          >
            <path
              d="M2 3.5L4.5 6L7 3.5"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      {open && !isDisabled ? (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label="Choose a model"
          data-testid="provider-picker-listbox"
          onKeyDown={onListKeyDown}
          className="absolute bottom-full z-20 mb-2 max-h-[320px] w-[300px] overflow-y-auto rounded-[10px] border border-chat-rule bg-chat-panel py-1.5 shadow-lg"
        >
          {pinIsValid
            ? (() => {
                flatIndex += 1;
                const idx = flatIndex;
                return (
                  <li
                    key="__auto"
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    data-testid="provider-picker-option-auto"
                    onClick={() => selectOption({ kind: 'auto' })}
                    className="cursor-pointer px-3 py-1.5 text-[12.5px] text-chat-ink outline-none hover:bg-chat-hover focus:bg-chat-hover"
                  >
                    Auto
                  </li>
                );
              })()
            : null}

          {groups.map((group) => (
            <li key={group.provider} role="presentation" className="py-0.5">
              <div
                role="presentation"
                className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide text-chat-ink-3"
              >
                {group.provider}
              </div>
              <ul role="presentation" className="m-0 list-none p-0">
                {group.entries.map((entry) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const selected =
                    pinIsValid &&
                    entry.provider === pinnedProvider &&
                    entry.model === pinnedModel;
                  return (
                    <li
                      key={`${entry.provider}/${entry.model}`}
                      ref={(el) => {
                        optionRefs.current[idx] = el;
                      }}
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      data-testid={`provider-picker-option-${entry.provider}-${entry.model}`}
                      onClick={() => selectOption({ kind: 'model', entry })}
                      className="flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 outline-none hover:bg-chat-hover focus:bg-chat-hover"
                    >
                      <span className="mono text-[12.5px] text-chat-ink">
                        {entry.model}
                      </span>
                      <span className="text-[11px] text-chat-ink-3">
                        {formatCostPair(entry)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ProviderGroup = {
  provider: string;
  entries: ProviderCatalogEntry[];
};

function groupByProvider(entries: ProviderCatalogEntry[]): ProviderGroup[] {
  const order: string[] = [];
  const map = new Map<string, ProviderCatalogEntry[]>();
  for (const entry of entries) {
    if (!map.has(entry.provider)) {
      map.set(entry.provider, []);
      order.push(entry.provider);
    }
    map.get(entry.provider)!.push(entry);
  }
  return order.map((provider) => ({
    provider,
    entries: map.get(provider)!,
  }));
}

/**
 * Format the prompt/completion cost pair in the locked PRD format
 * `$0.15 / $0.60 per 1M`. When BOTH sides are null, render a single em-dash.
 * When one side is null, render an em-dash for that side only.
 */
function formatCostPair(entry: ProviderCatalogEntry): string {
  const { promptPerMillion: p, completionPerMillion: c } = entry;
  if (p === null && c === null) return '—';
  const left = p === null ? '—' : `$${formatUsd(p)}`;
  const right = c === null ? '—' : `$${formatUsd(c)}`;
  return `${left} / ${right} per 1M`;
}

/**
 * Print the pricebook value with whatever decimals it carries, but ensure a
 * minimum of two decimals for sub-dollar values so `$0.6` reads as `$0.60`
 * (matches the PRD's `$0.15 / $0.60 per 1M` example). Whole numbers print
 * without forced decimals (e.g. `$10`, `$3`).
 */
function formatUsd(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // At least 2 decimals for fractional values.
  const fixed2 = value.toFixed(2);
  // If the raw value has MORE than 2 significant decimals, keep them.
  const raw = String(value);
  return raw.length > fixed2.length ? raw : fixed2;
}
