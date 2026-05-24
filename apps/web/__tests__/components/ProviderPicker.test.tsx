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
  // Task 117-118
  it('renders the locked env-var copy and does not open when no providers are configured', async () => {
    renderPicker({ catalog: EMPTY_CATALOG });
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent(
      'No providers configured — set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY in .env.',
    );
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
