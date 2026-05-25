// (auth) route group layout — split-pane auth shell.
//
// Mirrors `docs/design/project/auth.jsx` (.auth-shell + .auth-side +
// .auth-form-wrap). Left pane carries the brand mark + version seal +
// pitch + footer; right pane hosts the form (login/signup). Server
// component — no interactivity in the chrome itself.
//
// On mobile the grid collapses to a single stacked column (mobile-first
// fallback) so the form is still reachable on phones; Phase A is
// desktop-targeted.

import { Wordmark } from '@/components/brand/Wordmark';
import { AuthFormSheet } from '@/components/auth/AuthFormSheet';

type AuthLayoutProps = {
  children: React.ReactNode;
};

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div
      data-testid="auth-layout"
      className="grid min-h-screen grid-cols-1 md:grid-cols-2 bg-chat-bg text-chat-ink"
    >
      <aside
        data-testid="auth-side"
        className="flex flex-col justify-between border-b md:border-b-0 md:border-r border-chat-rule bg-chat-panel px-10 py-8 md:px-10 md:py-8"
      >
        <div>
          <Wordmark />
          <div
            data-testid="auth-seal"
            className="mt-6 text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
          >
            v0.1.0 · early preview
          </div>
        </div>

        <div className="mt-10 max-w-[380px]">
          <h1
            className="serif m-0 mb-5 text-[52px] font-normal leading-[1.02] tracking-[-0.02em] text-chat-ink"
            style={{ textWrap: 'balance' }}
          >
            Chat first.
            <br />
            Observe <em className="italic text-acc">everything</em>.
          </h1>
          <p className="m-0 text-[14px] leading-[1.55] text-chat-ink-2">
            A streaming, multi-provider chat app wired to an inference-logging
            pipeline. Every model call from{' '}
            <span className="mono" style={{ fontSize: 13 }}>
              /chat
            </span>{' '}
            lands in the operator console within ~5 seconds — traces, cost, and
            replay over the same data.
          </p>
        </div>

        <div className="mt-10 flex justify-between text-[11.5px] text-chat-ink-3">
          <span className="mono">otel → redpanda → postgres</span>
          <span>argus</span>
        </div>
      </aside>

      <AuthFormSheet>{children}</AuthFormSheet>
    </div>
  );
}
