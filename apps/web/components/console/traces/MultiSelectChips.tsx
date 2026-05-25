// MultiSelectChips — shared chip-style multi-select primitive.
//
// LLD frontend-web Phase 7: the four filter multi-selects (provider / model /
// status / conversation) are the same interaction — a row of toggle chips that
// emit the resulting array. Factored here (DRY) so the four wrappers only
// supply their option set + test-id prefix; each chip is a real <button> with
// `aria-pressed` and a stable `data-testid` per the a11y-automation discipline.

'use client';

export type ChipOption<T extends string> = { value: T; label: string };

export type MultiSelectChipsProps<T extends string> = {
  /** Stable, kebab-case prefix — each chip gets `${testIdPrefix}-${value}`. */
  testIdPrefix: string;
  /** Accessible group label. */
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
  const toggle = (value: T) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <div
      data-testid={`${testIdPrefix}-group`}
      role="group"
      aria-label={groupLabel}
      className="flex flex-wrap items-center gap-1.5"
    >
      {options.length === 0 && (
        <span className="text-[11.5px] text-chat-ink-3">No options</span>
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
            className={`min-h-8 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acc ${
              isSelected
                ? 'border-acc bg-acc-soft text-chat-ink'
                : 'border-chat-rule bg-chat-panel text-chat-ink-2 hover:bg-chat-hover'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
