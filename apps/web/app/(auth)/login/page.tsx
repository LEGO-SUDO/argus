// /login — email + password form rebuilt to match the design prototype's
// `.auth-form` block in `docs/design/project/styles.css` (lines 161-260) and
// `auth.jsx`.
//
// Visual fidelity rules (vs the original implementation):
//   - Form heading is the Instrument Serif `<h2>` "Welcome back" (the pitch
//     `<h1>` lives in the (auth) layout's left pane)
//   - Labels are 11px uppercase letter-spaced 0.06em
//   - Primary button uses `bg-chat-ink` (not `bg-acc`) — the acc accent is
//     reserved for the switch-link underline
//   - Errors render in a tinted `.err-banner` card, not bare text
//   - DemoHint card is always visible so a fresh visitor can sign in without
//     spelunking through env files for credentials
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { ApiError, AuthError, authFetch } from '@/lib/auth-fetch';
import { DemoHint, DEMO_EMAIL, DEMO_PASSWORD } from '@/components/auth/DemoHint';
import type { AuthResponse, LoginRequest } from '@argus/contracts';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: LoginRequest = { email, password };
      await authFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body,
      });
      router.push('/chat');
    } catch (err) {
      if (err instanceof AuthError) {
        setError('Invalid email or password.');
      } else if (err instanceof ApiError && err.status < 500) {
        setError(err.message || 'Could not sign in. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="login-form"
      noValidate
      className="flex flex-col"
    >
      <h2 className="serif m-0 mb-[6px] text-[32px] font-normal tracking-[-0.015em] text-chat-ink">
        Welcome back
      </h2>
      <p className="m-0 mb-7 text-[13px] text-chat-ink-2">
        Sign in to resume your conversations.
      </p>

      {error ? (
        <div
          role="alert"
          data-testid="login-error"
          className="mb-4 rounded-[6px] border border-err/25 bg-err/[0.08] px-[11px] py-[9px] text-[12px] leading-[1.4] text-err"
        >
          {error}
        </div>
      ) : null}

      <div className="mb-4">
        <label
          htmlFor="login-email-input"
          className="mb-1.5 block text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
        >
          Email
        </label>
        <input
          id="login-email-input"
          type="email"
          name="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          placeholder="you@company.com"
          data-testid="login-email"
          className="block w-full rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-[11px] text-[14px] text-chat-ink placeholder:text-chat-ink-3 outline-none transition-colors focus:border-acc disabled:opacity-60"
        />
      </div>

      <div className="mb-4">
        <label
          htmlFor="login-password-input"
          className="mb-1.5 block text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
        >
          Password
        </label>
        <input
          id="login-password-input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          placeholder="••••••••"
          data-testid="login-password"
          className="block w-full rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-[11px] text-[14px] text-chat-ink placeholder:text-chat-ink-3 outline-none transition-colors focus:border-acc disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={submitting || email.length === 0 || password.length === 0}
        data-testid="login-submit"
        aria-label="Sign in"
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[6px] bg-chat-ink px-3 py-3 text-[14px] font-medium tracking-[-0.005em] text-chat-bg transition-opacity hover:opacity-[0.88] focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <div className="mt-[18px] text-center text-[13px] text-chat-ink-2">
        New here?{' '}
        <Link
          href="/signup"
          data-testid="login-switch-signup"
          className="font-medium text-chat-ink underline decoration-acc underline-offset-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-acc rounded-sm"
        >
          Create an account
        </Link>
      </div>

      <DemoHint onFill={fillDemo} />
    </form>
  );
}
