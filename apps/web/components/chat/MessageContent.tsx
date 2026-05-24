// MessageContent — the message body renderer (LLD Block E, Tasks 68-79).
//
// Assistant content is rendered as Markdown via react-markdown wired with:
//   - remark-gfm (tables, task lists, strikethrough, autolinks)
//   - rehype-sanitize using the locked schema from `sanitize-markdown.ts`
//   - NO rehype-raw — so raw HTML in the source is escaped to text before the
//     rehype pipeline (defense-in-depth with the sanitizer; HLD Decision 7)
//
// User content is rendered as INERT plain text in a <span> — never processed
// as Markdown. The user's literal characters (`**`, `[ ]( )`, raw `<tags>`)
// must survive verbatim so a user can't inject formatting/links into their
// own bubble.
//
// External links (absolute http/https to a different origin) render with
// `target="_blank"` and `rel="noopener noreferrer"` via a custom `a`
// renderer. Same-origin and relative links render as plain in-app links.
// rehype-sanitize does not add these attributes itself.
//
// Partial mid-stream Markdown is safe: react-markdown does not throw on
// incomplete syntax (open fences, unfinished links, half-formed tables). We
// deliberately do NOT wrap the tree in a try/catch — try/catch around JSX
// does not catch render-time errors. The component renders resiliently
// without a boundary; if a future need for one arises it would be a separate
// MessageContentErrorBoundary class component (omitted for v1).
'use client';

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

import { rehypeUrlSchemeGuard, sanitizeSchema } from '@/lib/sanitize-markdown';

type MessageContentProps = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** True while the assistant turn is still streaming (passed through for
   *  future streaming-only affordances; does not change render policy). */
  isStreaming?: boolean;
};

// Custom renderers. The anchor renderer discriminates external from
// same-origin links so external links open in a new tab with the
// security-hardening rel attributes.
const components: Components = {
  a({ href, children, ...rest }) {
    if (href && isExternalHref(href)) {
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    // Same-origin / relative / hash links: render plain, no new-tab attrs.
    return (
      <a {...rest} href={href}>
        {children}
      </a>
    );
  },
};

export function MessageContent({ role, content, isStreaming }: MessageContentProps) {
  // `isStreaming` is accepted for API completeness; render policy is the same
  // streaming or not (react-markdown handles partial input gracefully).
  void isStreaming;

  if (role !== 'assistant') {
    // Inert plain text — no Markdown processing. `whitespace-pre-wrap` is
    // applied by the caller's container; here we just emit the raw string.
    return <span data-testid="message-content-plain">{content}</span>;
  }

  return (
    <div data-testid="message-content-markdown" className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        // rehypeUrlSchemeGuard runs FIRST — it strips obfuscated/encoded
        // dangerous schemes (jav&#x61;script:, JaVaScRiPt:, %6a-encoded, tab/
        // newline/NUL mangled) before the sanitizer's scheme matcher sees the
        // value. rehype-sanitize is the final allow-list pass.
        rehypePlugins={[rehypeUrlSchemeGuard, [rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}

/**
 * True when `href` is an absolute http/https URL whose origin differs from
 * the current page origin. On the server (no `window`) every absolute
 * http/https URL is treated as external — conservative, since we can't
 * compare origins. Relative paths, protocol-relative `//`, hash `#`, and
 * `mailto:` are NOT external (they either stay in-app or are handled by the
 * browser's default scheme handler).
 */
function isExternalHref(href: string): boolean {
  // Only absolute http(s) URLs can be "external". Everything else is in-app.
  if (!/^https?:\/\//i.test(href)) {
    return false;
  }
  if (typeof window === 'undefined') {
    // SSR: can't compare origins — treat all absolute http(s) as external.
    return true;
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.origin !== window.location.origin;
  } catch {
    // Malformed URL — be conservative and treat as external so it opens in a
    // new tab rather than navigating the app to a broken in-app route.
    return true;
  }
}
