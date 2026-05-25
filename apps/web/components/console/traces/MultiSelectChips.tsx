// MultiSelectChips — shared chip-style multi-select primitive.
//
// Reskinned (REVIEW-BRIEF Finding 4): the chip trigger adopts .filter-chip
// styling. The dropdown panel overlays below the trigger; clicking outside
// (document mousedown) or pressing Esc closes it.
//
// All behavioural contracts are preserved: aria-pressed per chip, stable
// data-testid, the group role/label, and the toggle-in-array logic.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';

export type ChipOption<T extends string> = { value: T; label: string };

export type MultiSelectChipsProps<T extends string> = {
  /** Stable, kebab-case prefix — each chip gets `${testIdPrefix}-${value}`. */
  testIdPrefix: string;
  /** Accessible group label used on the trigger and the role=group panel. */
  groupLabel: string;
  options: ReadonlyArray<ChipOption<T>>;
  selected: ReadonlyArray<T>;
  onChange: (next: T[]) => void;
};

export function MultiSelectChips<T extends string>({
  testIdPrefix,
  groupLabel,
  options,
  selected,
  onChange,
}: MultiSelectChipsProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = (value: T) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  // Close on outside click or Esc
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  const hasSelection = selected.length > 0;
  const triggerLabel = hasSelection
    ? `${groupLabel.toLowerCase()}: ${selected.length} selected`
    : `${groupLabel.toLowerCase()}: any`;

  return (
    <div
      ref={containerRef}
      data-testid={`${testIdPrefix}-group`}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <button
        type="button"
        data-testid={`${testIdPrefix}-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filter by ${groupLabel}`}
        onClick={() => setOpen((v) => !v)}
        className={`filter-chip${hasSelection ? ' active' : ''}`}
      >
        <Icon name="filter" size={10} aria-hidden="true" />
        {triggerLabel}
        {hasSelection && (
          <span
            className="x"
            role="presentation"
            aria-hidden="true"
          >
            ×
          </span>
        )}
      </button>

      {open && (
        <div
          role="group"
          aria-label={groupLabel}
          data-testid={`${testIdPrefix}-dropdown`}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 10,
            background: 'var(--con-panel)',
            border: '1px solid var(--con-rule)',
            borderRadius: 4,
            padding: '6px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            minWidth: '180px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {options.length === 0 && (
            <span
              style={{
                fontSize: '11.5px',
                color: 'var(--con-dim)',
                padding: '2px 4px',
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
              }}
            >
              No options
            </span>
          )}
          {options.map((option) => {
            const isSelected = selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                data-testid={`${testIdPrefix}-${option.value}`}
                aria-pressed={isSelected}
                aria-label={`${groupLabel}: ${option.label}`}
                onClick={() => toggle(option.value)}
                className={`filter-chip${isSelected ? ' active' : ''}`}
                style={{ fontSize: '11px' }}
              >
                {isSelected && (
                  <Icon name="check" size={9} aria-hidden="true" />
                )}
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
