// /signup — email + password + confirm form rebuilt to match the design
// prototype's `.auth-form` block (mirrors /login but adds a confirm field).
//
// See login/page.tsx for the visual-fidelity rules; both pages share the
// (auth) layout's split-pane shell and the DemoHint card.
'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { ApiError, authFetch } from '@/lib/auth-fetch';
import { DemoHint, DEMO_EMAIL, DEMO_PASSWORD } from '@/components/auth/DemoHint';
import type { AuthResponse, SignupRequest } from '@argus/contracts';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordMismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const body: SignupRequest = { email, password };
      await authFetch<AuthResponse>('/api/auth/signup', {
        method: 'POST',
        body,
      });
      router.push('/chat');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError('An account with that email already exists.');
        } else if (err.status === 400) {
          setError(err.message || 'Please check your input and try again.');
        } else {
          setError('Something went wrong. Please try again.');
        }
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
    setConfirm(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="signup-form"
      noValidate
      className="flex flex-col"
    >
      <h2 className="serif m-0 mb-[6px] text-[32px] font-normal tracking-[-0.015em] text-chat-ink">
        Create your account
      </h2>
      <p className="m-0 mb-7 text-[13px] text-chat-ink-2">
        Sign up with email + password. Takes one second.
      </p>

      {error ? (
        <div
          role="alert"
          data-testid="signup-error"
          className="mb-4 rounded-[6px] border border-err/25 bg-err/[0.08] px-[11px] py-[9px] text-[12px] leading-[1.4] text-err"
        >
          {error}
        </div>
      ) : null}

      <div className="mb-4">
        <label
          htmlFor="signup-email-input"
          className="mb-1.5 block text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
        >
          Email
        </label>
        <input
          id="signup-email-input"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          placeholder="you@company.com"
          data-testid="signup-email"
          className="block w-full rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-[11px] text-[14px] text-chat-ink placeholder:text-chat-ink-3 outline-none transition-colors focus:border-acc disabled:opacity-60"
        />
      </div>

      <div className="mb-4">
        <label
          htmlFor="signup-password-input"
          className="mb-1.5 block text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
        >
          Password
        </label>
        <input
          id="signup-password-input"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          placeholder="••••••••"
          data-testid="signup-password"
          className="block w-full rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-[11px] text-[14px] text-chat-ink placeholder:text-chat-ink-3 outline-none transition-colors focus:border-acc disabled:opacity-60"
        />
      </div>

      <div className="mb-4">
        <label
          htmlFor="signup-confirm-input"
          className="mb-1.5 block text-[11px] uppercase tracking-[0.06em] text-chat-ink-3"
        >
          Confirm password
        </label>
        <input
          id="signup-confirm-input"
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          placeholder="••••••••"
          data-testid="signup-confirm"
          aria-invalid={passwordMismatch || undefined}
          className="block w-full rounded-[6px] border border-chat-rule bg-chat-bg px-3 py-[11px] text-[14px] text-chat-ink placeholder:text-chat-ink-3 outline-none transition-colors focus:border-acc disabled:opacity-60 aria-[invalid=true]:border-err"
        />
        {passwordMismatch ? (
          <span
            role="alert"
            data-testid="signup-confirm-mismatch"
            className="mt-1 inline-block text-[11.5px] text-err"
          >
            Passwords do not match.
          </span>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={
          submitting ||
          email.length === 0 ||
          password.length < 8 ||
          confirm.length === 0 ||
          passwordMismatch
        }
        data-testid="signup-submit"
        aria-label="Create account"
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[6px] bg-chat-ink px-3 py-3 text-[14px] font-medium tracking-[-0.005em] text-chat-bg transition-opacity hover:opacity-[0.88] focus:outline-none focus-visible:ring-2 focus-visible:ring-acc disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Creating account…' : 'Create account'}
      </button>

      <div className="mt-[18px] text-center text-[13px] text-chat-ink-2">
        Already have one?{' '}
        <Link
          href="/login"
          data-testid="signup-switch-login"
          className="font-medium text-chat-ink underline decoration-acc underline-offset-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-acc rounded-sm"
        >
          Sign in
        </Link>
      </div>

      <DemoHint onFill={fillDemo} />
    </form>
  );
}
