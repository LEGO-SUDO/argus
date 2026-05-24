// Tests for <ClearModal /> (LLD Tasks 78-87).
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/console-api', () => ({
  previewClear: jest.fn(),
  executeClear: jest.fn(),
}));
import { previewClear, executeClear } from '@/lib/console-api';
import { ClearModal } from '@/components/console/ClearModal';

const mockPreview = previewClear as jest.Mock;
const mockExecute = executeClear as jest.Mock;
const BREAKDOWN = { total: 9, chat: 5, replay: 2, sample: 2 };

beforeEach(() => {
  mockPreview.mockReset().mockResolvedValue(BREAKDOWN);
  mockExecute.mockReset().mockResolvedValue(BREAKDOWN);
});

describe('<ClearModal /> confirmation gating (Task 78)', () => {
  it('keeps the destructive button disabled until CLEAR is typed exactly', async () => {
    render(<ClearModal onClose={() => undefined} />);
    const confirm = screen.getByTestId('console-clear-modal-confirm');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId('console-clear-modal-input'), 'clear');
    expect(confirm).toBeDisabled(); // case mismatch
    await userEvent.clear(screen.getByTestId('console-clear-modal-input'));
    await userEvent.type(screen.getByTestId('console-clear-modal-input'), 'CLEAR');
    expect(confirm).not.toBeDisabled();
  });
});

describe('<ClearModal /> breakdown (Task 80)', () => {
  it('renders the per-kind counts and total from the preview response', async () => {
    render(<ClearModal onClose={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByTestId('console-clear-modal-breakdown')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('console-clear-modal-count-total')).toHaveTextContent('9');
    expect(screen.getByTestId('console-clear-modal-count-chat')).toHaveTextContent('5');
    expect(screen.getByTestId('console-clear-modal-count-replay')).toHaveTextContent('2');
    expect(screen.getByTestId('console-clear-modal-count-sample')).toHaveTextContent('2');
  });
});

describe('<ClearModal /> submit flow (Task 82)', () => {
  it('shows an in-flight status then fires onCleared + onClose on success', async () => {
    let resolveExec!: (v: typeof BREAKDOWN) => void;
    mockExecute.mockReturnValue(
      new Promise((r) => {
        resolveExec = r;
      }),
    );
    const onClose = jest.fn();
    const onCleared = jest.fn();
    render(<ClearModal onClose={onClose} onCleared={onCleared} />);
    await userEvent.type(screen.getByTestId('console-clear-modal-input'), 'CLEAR');
    await userEvent.click(screen.getByTestId('console-clear-modal-confirm'));
    expect(screen.getByTestId('console-clear-modal-status')).toHaveTextContent(/aborting/i);
    await waitFor(() => resolveExec(BREAKDOWN));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCleared).toHaveBeenCalledTimes(1);
  });
});

describe('<ClearModal /> Cancel (Task 84)', () => {
  it('always closes without executing — before typing CLEAR', async () => {
    const onClose = jest.fn();
    render(<ClearModal onClose={onClose} />);
    await userEvent.click(screen.getByTestId('console-clear-modal-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('always closes without executing — after typing CLEAR', async () => {
    const onClose = jest.fn();
    render(<ClearModal onClose={onClose} />);
    await userEvent.type(screen.getByTestId('console-clear-modal-input'), 'CLEAR');
    await userEvent.click(screen.getByTestId('console-clear-modal-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('<ClearModal /> execute failure (Task 86)', () => {
  it('surfaces an inline error, stays retryable, and does not fire onCleared', async () => {
    mockExecute.mockRejectedValue(new Error('clear failed'));
    const onClose = jest.fn();
    const onCleared = jest.fn();
    render(<ClearModal onClose={onClose} onCleared={onCleared} />);
    await userEvent.type(screen.getByTestId('console-clear-modal-input'), 'CLEAR');
    await userEvent.click(screen.getByTestId('console-clear-modal-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('console-clear-modal-error')).toHaveTextContent('clear failed'),
    );
    expect(onCleared).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('console-clear-modal-confirm')).not.toBeDisabled();
  });
});
