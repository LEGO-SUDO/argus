// DemoHint — dashed card listing the seeded demo credentials with a button
// that fills them into the parent form.
//
// Mirrors `.demo-hint` in `docs/design/project/styles.css` (lines 234-260)
// and the corresponding JSX block in `docs/design/project/auth.jsx`.
//
// The credentials are the ones seeded by the api on first boot
// (`demo@argus.dev` / `let-me-in-9`); they're hardcoded here on purpose
// because this card exists specifically so a fresh visitor can sign in
// without going to look up env values — fetching from an env var would
// defeat the visibility.
'use client';

import type { MouseEvent } from 'react';

export const DEMO_EMAIL = 'demo@argus.dev';
export const DEMO_PASSWORD = 'let-me-in-9';

type DemoHintProps = {
  onFill: () => void;
};

export function DemoHint({ onFill }: DemoHintProps) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    onFill();
  }
  return (
    <div
      data-testid="auth-demo-hint"
      className="mt-7 rounded-[6px] border border-dashed border-chat-rule p-[14px] text-[12px] leading-[1.5] text-chat-ink-2"
    >
      <b className="font-medium text-chat-ink">Want to try it out?</b>
      <br />A demo account is seeded on first boot:{' '}
      <code className="mono rounded-[3px] border border-chat-rule bg-chat-bg px-[5px] py-[1px] text-[11.5px]">
        {DEMO_EMAIL}
      </code>{' '}
      /{' '}
      <code className="mono rounded-[3px] border border-chat-rule bg-chat-bg px-[5px] py-[1px] text-[11.5px]">
        {DEMO_PASSWORD}
      </code>
      .
      <br />
      <button
        type="button"
        data-testid="auth-demo-fill"
        aria-label="Fill demo credentials"
        onClick={handleClick}
        className="mt-2.5 inline-flex items-center font-medium text-[11.5px] text-acc-strong underline underline-offset-[3px] decoration-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-acc rounded-sm"
      >
        Fill demo credentials →
      </button>
    </div>
  );
}
