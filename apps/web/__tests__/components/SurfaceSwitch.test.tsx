// SurfaceSwitch — the chat ⇄ console pill. Verifies both surfaces link
// correctly and the active one is marked, so /console is reachable from /chat.
import { render, screen } from '@testing-library/react';
import { SurfaceSwitch } from '@/components/chat/SurfaceSwitch';

let mockPath = '/chat';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPath,
}));

describe('SurfaceSwitch', () => {
  it('links to /console so it is reachable from the chat surface', () => {
    mockPath = '/chat';
    render(<SurfaceSwitch />);
    const consoleLink = screen.getByTestId('surface-switch-console');
    expect(consoleLink).toHaveAttribute('href', '/console');
  });

  it('marks /chat active on the chat surface', () => {
    mockPath = '/chat';
    render(<SurfaceSwitch />);
    expect(screen.getByTestId('surface-switch-chat')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('surface-switch-console')).not.toHaveAttribute('aria-current');
  });

  it('marks /console active when on the console surface', () => {
    mockPath = '/console/traces';
    render(<SurfaceSwitch />);
    expect(screen.getByTestId('surface-switch-console')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('surface-switch-chat')).not.toHaveAttribute('aria-current');
  });
});
