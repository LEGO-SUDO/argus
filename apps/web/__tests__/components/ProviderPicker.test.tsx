// ProviderPicker — WAI-ARIA combobox/listbox tests (LLD Block G, Tasks
// 99-118).
//
// Trigger: button role=combobox with aria-expanded; dropdown: role=listbox;
// rows: role=option. Keyboard: ArrowDown opens + focuses first option;
// ArrowUp/Down navigate (wrap); Enter selects + closes; Escape closes +
// returns focus to trigger. Streaming disables the trigger. Empty catalog
// shows the locked env-var copy and does not open.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderPicker } from '@/components/chat/ProviderPicker';
import type { ProviderCatalog } from '@/lib/providers-api';

const CATALOG: ProviderCatalog = {
  providers: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      promptPerMillion: 0.15,
      completionPerMillion: 0.6,
      contextWindow: 128000,
    },
    {
      provider: 'openai',
      model: 'gpt-4o',
      promptPerMillion: 2.5,
      completionPerMillion: 10,
      contextWindow: 128000,
    },
    {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      promptPerMillion: 3,
      completionPerMillion: 15,
      contextWindow: 200000,
    },
  ],
};

const EMPTY_CATALOG: ProviderCatalog = { providers: [] };

const noop = () => undefined;

function renderPicker(overrides: Partial<React.ComponentProps<typeof ProviderPicker>> = {}) {
  return render(
    <ProviderPicker
      catalog={CATALOG}
      pinnedProvider={null}
      pinnedModel={null}
      onPin={noop}
      onClear={noop}
      streaming={false}
      {...overrides}
    />,
  );
}

describe('ProviderPicker — trigger label', () => {
  // Task 99-100
  it('shows "Auto" when no pin is set', () => {
    renderPicker();
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAccessibleName(/auto/i);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // Task 101-102
  it('shows the pinned provider + model label when a pin is set', () => {
    renderPicker({ pinnedProvider: 'openai', pinnedModel: 'gpt-4o-mini' });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAccessibleName(/openai/i);
    expect(trigger).toHaveAccessibleName(/gpt-4o-mini/i);
  });

  // Task 103-104
  it('falls back to "Auto" when the pinned model is not in the catalog', () => {
    renderPicker({
      pinnedProvider: 'openai',
      pinnedModel: 'ghost-model-not-in-catalog',
    });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAccessibleName(/auto/i);
    expect(trigger).not.toHaveAccessibleName(/ghost-model/i);
  });
});

describe('ProviderPicker — dropdown listing', () => {
  // Task 105-106
  it('opens to a grouped listbox with per-model cost on each option', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('combobox'));
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    // Group headings for each configured provider.
    expect(within(listbox).getByText('openai')).toBeInTheDocument();
    expect(within(listbox).getByText('anthropic')).toBeInTheDocument();
    // The gpt-4o-mini option's accessible name carries the locked cost
    // format "$0.15 / $0.60 per 1M".
    const miniOption = screen.getByRole('option', { name: /gpt-4o-mini/i });
    expect(miniOption).toHaveTextContent('$0.15 / $0.60 per 1M');
  });

  // Task 107-108
  it('shows an em-dash for unknown cost', async () => {
    const catalog: ProviderCatalog = {
      providers: [
        {
          provider: 'local',
          model: 'llama-3',
          promptPerMillion: null,
          completionPerMillion: null,
          contextWindow: null,
        },
      ],
    };
    renderPicker({ catalog });
    await userEvent.click(screen.getByRole('combobox'));
    const option = screen.getByRole('option', { name: /llama-3/i });
    expect(option).toHaveTextContent('—');
  });
});

describe('ProviderPicker — unavailable entries', () => {
  const CATALOG_WITH_UNAVAILABLE: ProviderCatalog = {
    providers: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptPerMillion: 0.15,
        completionPerMillion: 0.6,
        contextWindow: 128000,
        available: true,
      },
      {
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        promptPerMillion: 0,
        completionPerMillion: 0,
        contextWindow: 1000000,
        available: false,
      },
    ],
  };

  it('renders an unavailable model as a disabled option with an "unavailable" pill', async () => {
    renderPicker({ catalog: CATALOG_WITH_UNAVAILABLE });
    await userEvent.click(screen.getByRole('combobox'));
    // Rendered (so AT can announce it) but disabled + not roving-focusable.
    const row = screen.getByTestId(
      'provider-picker-option-gemini-gemini-3-flash-preview',
    );
    expect(row).toHaveAttribute('data-unavailable', 'true');
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAttribute('tabindex', '-1');
    expect(
      screen.getByTestId(
        'provider-picker-unavailable-pill-gemini-gemini-3-flash-preview',
      ),
    ).toHaveTextContent(/unavailable/i);
  });

  it('does not pin when an unavailable row is clicked', async () => {
    const onPin = jest.fn();
    renderPicker({ catalog: CATALOG_WITH_UNAVAILABLE, onPin });
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(
      screen.getByTestId(
        'provider-picker-option-gemini-gemini-3-flash-preview',
      ),
    );
    expect(onPin).not.toHaveBeenCalled();
    // Available options remain selectable.
    await userEvent.click(screen.getByRole('option', { name: /gpt-4o-mini/i }));
    expect(onPin).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
  });
});

describe('ProviderPicker — selection', () => {
  // Task 109-110
  it('invokes onPin with the chosen provider+model and closes', async () => {
    const onPin = jest.fn();
    renderPicker({ onPin });
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: /gpt-4o-mini/i }));
    expect(onPin).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  // Task 111-112
  it('invokes onClear when selecting "Auto" while a pin is set', async () => {
    const onClear = jest.fn();
    renderPicker({
      pinnedProvider: 'openai',
      pinnedModel: 'gpt-4o-mini',
      onClear,
    });
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: /^auto$/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ProviderPicker — keyboard navigation', () => {
  // Task 113-114
  it('ArrowDown on the trigger opens and focuses the first option', async () => {
    renderPicker();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveFocus();
  });

  it('ArrowDown/ArrowUp move focus between options and wrap at the boundary', async () => {
    renderPicker();
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}'); // open, focus option 0
    const options = screen.getAllByRole('option');
    await userEvent.keyboard('{ArrowDown}');
    expect(options[1]).toHaveFocus();
    // Wrap: ArrowUp from option 0 → last option.
    await userEvent.keyboard('{ArrowUp}'); // back to 0
    expect(options[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}'); // wrap to last
    expect(options[options.length - 1]).toHaveFocus();
  });

  it('Enter on a focused option invokes onPin and closes', async () => {
    const onPin = jest.fn();
    renderPicker({ onPin });
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}'); // open, focus first option
    // First option in the catalog is openai/gpt-4o-mini (the Auto row is
    // omitted when no pin is set).
    await userEvent.keyboard('{Enter}');
    expect(onPin).toHaveBeenCalledWith('openai', 'gpt-4o-mini');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the dropdown and returns focus to the trigger', async () => {
    renderPicker();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('ProviderPicker — streaming gate', () => {
  // Task 115-116
  it('is disabled while streaming and does not open on click', async () => {
    renderPicker({ streaming: true });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ProviderPicker — empty state', () => {
  const FULL_GUIDANCE =
    'No providers configured — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.';

  // Task 117-118 + design review FIX 5: the VISIBLE pill label is short ("No
  // providers") so the truncating max-w-[280px] trigger doesn't clip the full
  // sentence mid-word; the full env-var guidance lives in the accessible name
  // (aria-label) and the hover title instead.
  it('shows a short visible label and does not open when no providers are configured', async () => {
    renderPicker({ catalog: EMPTY_CATALOG });
    const trigger = screen.getByRole('combobox');
    // Short visible label — the full sentence is NOT in the visible text.
    expect(trigger).toHaveTextContent('No providers');
    expect(trigger).not.toHaveTextContent(/set OPENAI_API_KEY/);
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('carries the full env-var guidance in the accessible name and title', () => {
    renderPicker({ catalog: EMPTY_CATALOG });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAccessibleName(FULL_GUIDANCE);
    expect(trigger).toHaveAttribute('title', FULL_GUIDANCE);
  });
});

// ---------------------------------------------------------------------------
// Codex finding #6 — loading vs empty-configured. While the catalog fetch is
// in flight the picker shows a disabled "Loading models…" state, NOT the
// env-var empty-state copy (which only applies once the fetch resolves with
// zero providers).
// ---------------------------------------------------------------------------
describe('ProviderPicker — loading state', () => {
  it('shows "Loading models…" (not the env-var copy) while loading, even with an empty catalog', async () => {
    renderPicker({ catalog: EMPTY_CATALOG, loading: true });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Loading models…');
    expect(trigger).not.toHaveTextContent(/No providers configured/i);
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Codex finding #4 — optimistic PATCH race. While a pin PATCH is in flight the
// trigger is genuinely disabled so a second racing PATCH can't be fired.
// ---------------------------------------------------------------------------
describe('ProviderPicker — busy (PATCH in flight)', () => {
  it('disables the trigger and refuses to open while busy', async () => {
    renderPicker({ busy: true });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Codex finding #3 — duplicate listbox ids. Two pickers on one page must not
// share an id (useId gives each instance a unique one).
// ---------------------------------------------------------------------------
describe('ProviderPicker — unique listbox ids (useId)', () => {
  it('gives two instances distinct aria-controls / listbox ids', () => {
    render(
      <div>
        <ProviderPicker
          catalog={CATALOG}
          pinnedProvider={null}
          pinnedModel={null}
          onPin={noop}
          onClear={noop}
          streaming={false}
        />
        <ProviderPicker
          catalog={CATALOG}
          pinnedProvider={null}
          pinnedModel={null}
          onPin={noop}
          onClear={noop}
          streaming={false}
        />
      </div>,
    );
    const triggers = screen.getAllByRole('combobox');
    expect(triggers).toHaveLength(2);
    const a = triggers[0]!.getAttribute('aria-controls');
    const b = triggers[1]!.getAttribute('aria-controls');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Design review FIX 3 — combobox a11y conflict. The picker uses the
// ROVING-FOCUS model: DOM focus moves into the option rows and the active
// option carries tabindex=0 (the rest -1). It must NOT ALSO set
// aria-activedescendant — that would mix two mutually-exclusive ARIA patterns.
// This replaces the prior aria-activedescendant suite (Codex finding #5),
// which set up the conflicting half of the pattern.
// ---------------------------------------------------------------------------
describe('ProviderPicker — roving focus (no aria-activedescendant)', () => {
  it('moves real DOM focus to the active option and never sets aria-activedescendant', async () => {
    renderPicker();
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}'); // open, focus option 0
    const options = screen.getAllByRole('option');
    // Roving focus: the active option IS the focused element.
    expect(options[0]).toHaveFocus();
    // ...and aria-activedescendant must be absent (the conflicting pattern).
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
    // Move down — focus rolls to the next option; still no activedescendant.
    await userEvent.keyboard('{ArrowDown}');
    expect(options[1]).toHaveFocus();
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
  });

  it('applies a roving tabindex: only the active option is tabbable', async () => {
    renderPicker();
    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}'); // open, focus option 0
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('tabindex', '0');
    expect(options[1]).toHaveAttribute('tabindex', '-1');
    // Roll focus down — tabindex follows the active option.
    await userEvent.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('tabindex', '-1');
    expect(options[1]).toHaveAttribute('tabindex', '0');
  });

  it('has no aria-activedescendant while closed', () => {
    renderPicker();
    expect(
      screen.getByRole('combobox').getAttribute('aria-activedescendant'),
    ).toBeNull();
  });
});
