// Tests for <SampleDataButton /> (LLD Tasks 74-77).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/console-api', () => ({ generateSample: jest.fn() }));
import { generateSample } from '@/lib/console-api';
import { SampleDataButton } from '@/components/console/SampleDataButton';

const mockGenerate = generateSample as jest.Mock;
beforeEach(() => mockGenerate.mockReset());

describe('<SampleDataButton /> success (Task 74)', () => {
  it('shows an interim status then a count-aware success message', async () => {
    let resolve!: (v: { workspaceId: string; count: number }) => void;
    mockGenerate.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const onGenerated = jest.fn();
    render(<SampleDataButton onGenerated={onGenerated} />);

    await userEvent.click(screen.getByTestId('console-sample-data-button'));
    const status = screen.getByTestId('console-sample-data-status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/generating/i);

    await waitFor(() => resolve({ workspaceId: 'w', count: 7 }));
    await waitFor(() =>
      expect(screen.getByTestId('console-sample-data-status')).toHaveTextContent(
        /generated 7 inferences/i,
      ),
    );
    expect(onGenerated).toHaveBeenCalledWith(7);
  });
});

describe('<SampleDataButton /> failure (Task 76)', () => {
  it('surfaces an inline error and re-enables the button', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'));
    render(<SampleDataButton />);
    const button = screen.getByTestId('console-sample-data-button');
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId('console-sample-data-error')).toHaveTextContent('boom'),
    );
    expect(button).not.toBeDisabled();
  });
});
