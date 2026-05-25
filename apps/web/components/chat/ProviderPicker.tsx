// ProviderPicker — model selector following the WAI-ARIA 1.2 combobox-with-
// listbox pattern (LLD Block G, Tasks 99-118).
//
// Focus model: ROVING FOCUS (design review FIX 3). Real DOM focus moves into
// the option rows while the listbox is open; the active option carries
// `tabindex=0` and every other option `tabindex=-1`. We deliberately do NOT
// also set `aria-activedescendant` on the trigger — activedescendant and
// roving-focus are mutually-exclusive ARIA patterns (activedescendant keeps
// DOM focus on the combobox and only POINTS at the active option; roving
// focus actually MOVES focus). Mixing them double-announces and confuses AT.
// We chose roving focus because the keyboard handler + selection already live
// where focus lands (the `<ul>` and its `<li>`s), so it is the smaller, more
// robust delta.
//
// Trigger: a <button role="combobox"> whose aria-expanded reflects open
// state. Dropdown panel: role="listbox". Each model row: role="option".
//
// Keyboard (handler lives on the listbox, where focus is):
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
//   - Empty catalog: trigger shows a SHORT "No providers" label (the full
//     env-var guidance lives in the accessible name + title so the truncating
//     pill doesn't clip it — design review FIX 5), aria-disabled, does not
//     open.
//
// We implement the pattern inline with semantic elements + the documented
// handlers (no generic listbox primitive exists in this repo yet).
'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import type { ProviderCatalog, ProviderCatalogEntry } from '@/lib/providers-api';

// Empty-state copy (design review FIX 5). The full env-var guidance is too
// long for the truncating `max-w-[280px]` pill — it gets clipped mid-word and
// read verbatim by screen readers. So the VISIBLE label is short ("No
// providers") and the full sentence lives in the trigger's `title` (hover
// tooltip) + `aria-label` (the accessible name AT announces).
const EMPTY_STATE_VISIBLE_LABEL = 'No providers';
const EMPTY_STATE_FULL_GUIDANCE =
  'No providers configured — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.';

const LOADING_LABEL = 'Loading models…';

type ProviderPickerProps = {
  catalog: ProviderCatalog;
  pinnedProvider: string | null;
  pinnedModel: string | null;
  onPin: (provider: string, model: string) => void;
  onClear: () => void;
  streaming: boolean;
  /**
   * True while the catalog is still being fetched. Distinguishes the
   * disabled-loading state ("Loading models…") from the env-var empty-state
   * ("No providers configured…") that only applies after a fetch resolves
   * with zero providers (Codex finding #6).
   */
  loading?: boolean;
  /**
   * True while a pin PATCH is in flight. The trigger is genuinely disabled so
   * the user can't fire a second, racing PATCH before the first resolves
   * (Codex finding #4 — optimistic PATCH race).
   */
  busy?: boolean;
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
  loading = false,
  busy = false,
}: ProviderPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLUListElement | null>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Stable, INSTANCE-UNIQUE id linking the trigger (aria-controls) to the
  // listbox panel and seeding each option's id (Codex finding #3 — multiple
  // pickers on a page must not collide on a hardcoded listbox id).
  const reactId = useId();
  const listboxId = `provider-picker-listbox-${reactId}`;
  const optionId = useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId],
  );

  const isEmpty = catalog.providers.length === 0;
  // Disabled when streaming, while a PATCH is in flight, while loading, or
  // when the (resolved) catalog is empty. `loading` and `busy` are TRUE
  // disabled states — the trigger does not open.
  const isDisabled = streaming || busy || loading || isEmpty;

  // Is the pinned (provider, model) pair actually present in the catalog?
  const pinIsValid = useMemo(() => {
    if (!pinnedProvider || !pinnedModel) return false;
    return catalog.providers.some(
      (p) => p.provider === pinnedProvider && p.model === pinnedModel,
    );
  }, [catalog.providers, pinnedProvider, pinnedModel]);

  // Visible trigger label. Loading copy wins first (a fetch is in flight, so
  // we don't yet know whether the catalog is empty); then the SHORT empty-state
  // label (the full guidance moves to the title/aria-label — FIX 5); then a
  // valid pin; else Auto. (Codex finding #6 — no empty-state flash mid-fetch.)
  const triggerLabel = loading
    ? LOADING_LABEL
    : isEmpty
      ? EMPTY_STATE_VISIBLE_LABEL
      : pinIsValid
        ? `${pinnedProvider} · ${pinnedModel}`
        : 'Auto';

  // Accessible name + hover tooltip. For the empty state these carry the FULL
  // env-var guidance so screen readers and a hover read the actionable remedy
  // even though the visible pill stays short (FIX 5). Otherwise they mirror the
  // visible label.
  const triggerAccessibleLabel = isEmpty
    ? EMPTY_STATE_FULL_GUIDANCE
    : triggerLabel;
  const triggerTitle = isEmpty ? EMPTY_STATE_FULL_GUIDANCE : undefined;

  // Grouped catalog for rendering (provider → its model rows). Stable order
  // follows first-appearance in the catalog array.
  const groups = useMemo(() => groupByProvider(catalog.providers), [catalog.providers]);

  // Flat option list (in render order) for keyboard navigation + Enter
  // selection. The synthetic Auto option leads the list only when a pin is
  // active (so the user can switch back to Auto). Unavailable entries are
  // EXCLUDED here so they're never keyboard-reachable or Enter-selectable;
  // they still render (greyed, see below) but as presentational rows. The
  // exclusion keeps this list index-aligned with the rendered option rows.
  const options = useMemo<Option[]>(() => {
    const flat: Option[] = [];
    if (pinIsValid) flat.push({ kind: 'auto' });
    for (const group of groups) {
      for (const entry of group.entries) {
        if (isEntryAvailable(entry)) flat.push({ kind: 'model', entry });
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
        // `disabled` is the real, behavior-backed control — a disabled
        // <button> can't be clicked, focused-via-tab, or keyboard-activated,
        // so the aria-disabled/no-op-handler split is gone (Codex finding #5).
        // We mirror it onto aria-disabled for AT that read the ARIA layer.
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        // NOTE: no `aria-activedescendant` here. This picker uses the
        // roving-focus model — when the listbox opens, DOM focus moves into
        // the option rows (see the focus effect below), so the active option
        // is the document's focused element. Setting activedescendant too
        // would mix two mutually-exclusive ARIA patterns (design review FIX 3).
        // Explicit accessible name so screen readers (and the accessible-name
        // computation) get a stable label regardless of the nested span/SVG
        // structure. Mirrors the visible label EXCEPT in the empty state,
        // where it carries the full env-var guidance the short pill omits
        // (FIX 5).
        aria-label={triggerAccessibleLabel}
        // Hover tooltip — surfaces the full guidance for sighted mouse users
        // in the empty state (undefined otherwise so no redundant tooltip).
        title={triggerTitle}
        aria-busy={busy || loading || undefined}
        data-testid="provider-picker-trigger"
        data-loading={loading ? 'true' : undefined}
        data-busy={busy ? 'true' : undefined}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={onTriggerKeyDown}
        className={
          'inline-flex max-w-[280px] items-center gap-1.5 truncate rounded-full border border-chat-rule bg-chat-panel px-2.5 py-[3px] text-[11.5px] text-chat-ink-2 transition-colors hover:border-acc focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ' +
          (isDisabled ? 'cursor-not-allowed opacity-60' : '')
        }
      >
        <span className="truncate">{triggerLabel}</span>
        {!isEmpty && !loading ? (
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
                    id={optionId(idx)}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    role="option"
                    aria-selected={false}
                    // Roving tabindex: only the active option is tabbable;
                    // the rest are -1 so Tab doesn't walk every row.
                    tabIndex={idx === activeIndex ? 0 : -1}
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
                  // Unavailable entry (recent repeated failures): render a
                  // greyed, non-interactive row with an "unavailable" pill. It
                  // is NOT a role=option and is absent from `options`, so it
                  // can't be focused, Enter-selected, or clicked.
                  if (!isEntryAvailable(entry)) {
                    return (
                      <li
                        key={`${entry.provider}/${entry.model}`}
                        // Disabled option per the WAI-ARIA listbox pattern:
                        // still role=option + aria-disabled (so AT announces
                        // "dimmed/unavailable"), but tabIndex=-1 and absent
                        // from `options`, so roving focus + Enter skip it and
                        // a click is a no-op.
                        role="option"
                        aria-disabled="true"
                        aria-selected={false}
                        tabIndex={-1}
                        data-testid={`provider-picker-option-${entry.provider}-${entry.model}`}
                        data-unavailable="true"
                        title="Unavailable — this model has been failing recently"
                        className="flex cursor-not-allowed flex-col gap-0.5 px-3 py-1.5 opacity-50"
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="mono text-[12.5px] text-chat-ink-2">
                            {entry.model}
                          </span>
                          <span
                            data-testid={`provider-picker-unavailable-pill-${entry.provider}-${entry.model}`}
                            className="rounded-full border border-chat-rule px-1.5 py-[1px] text-[9.5px] font-medium uppercase tracking-wide text-chat-ink-3"
                          >
                            unavailable
                          </span>
                        </span>
                        <span className="text-[11px] text-chat-ink-3">
                          {formatCostPair(entry)}
                        </span>
                      </li>
                    );
                  }
                  flatIndex += 1;
                  const idx = flatIndex;
                  const selected =
                    pinIsValid &&
                    entry.provider === pinnedProvider &&
                    entry.model === pinnedModel;
                  return (
                    <li
                      key={`${entry.provider}/${entry.model}`}
                      id={optionId(idx)}
                      ref={(el) => {
                        optionRefs.current[idx] = el;
                      }}
                      role="option"
                      aria-selected={selected}
                      // Roving tabindex — see the Auto option above.
                      tabIndex={idx === activeIndex ? 0 : -1}
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

/** An entry is available unless the api explicitly marked it `false`. A
 *  missing flag (older payloads / fixtures) is treated as available. */
function isEntryAvailable(entry: ProviderCatalogEntry): boolean {
  return entry.available !== false;
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
