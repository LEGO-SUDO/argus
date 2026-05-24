// sanitize-markdown — the rehype-sanitize schema used by MessageContent, plus
// a small render helper for tests (LLD Block B, Tasks 33-46).
//
// Defense-in-depth model (HLD Decision 7):
//   1. react-markdown is configured WITHOUT `rehype-raw`, so raw HTML in the
//      Markdown source is escaped to text before the rehype pipeline runs.
//   2. rehype-sanitize with THIS schema is the second line of defence: it
//      drops any element/attribute not on the allow-list, and validates URL
//      schemes on `href`/`src` against a locked protocol allow-list.
//
// URL scheme allow-list (locked):
//   allowed:  http, https, mailto, protocol-relative `//`, relative paths, `#`
//   stripped: javascript:, data:, vbscript:
//
// Case-insensitivity + whitespace/control-char obfuscation are handled by
// hast-util-sanitize's protocol validator, which:
//   - extracts the scheme as the substring before the first `:`;
//   - treats a URL with no colon (or whose first colon comes after a `/`,
//     `?`, or `#`) as relative/safe (so `//host`, `/path`, `#frag` pass);
//   - matches the scheme by EXACT, case-sensitive equality against the
//     allow-list. Because our allow-list is lowercase-only, ANY mixed-case
//     or whitespace-mangled dangerous scheme (`JaVaScRiPt:`, `java\tscript:`)
//     fails the match and the attribute is dropped. Deny-by-default is the
//     property we rely on — we never enumerate the dangerous schemes.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
// `rehype-sanitize` re-exports the schema type as `Options` (it's the
// `hast-util-sanitize` `Schema`). We alias it to `SanitizeSchema` for a
// readable public type name.
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Locked URL scheme allow-list. The `//` (protocol-relative), relative, and
 * `#` (hash) forms are NOT schemes — they're handled by the validator's
 * "no colon before the first slash/question/hash → safe" rule, so they don't
 * appear here.
 */
const HREF_PROTOCOLS = ['http', 'https', 'mailto'] as const;
const SRC_PROTOCOLS = ['http', 'https', 'mailto'] as const;

/**
 * The sanitize schema MessageContent passes to `rehype-sanitize`. Derived
 * from hast-util-sanitize's GitHub-style `defaultSchema` (which already
 * restricts tagNames to the safe Markdown-rendered set and strips raw
 * `<script>`/`<iframe>`/etc.), with the href/src protocol allow-lists
 * tightened to the locked set. We drop `irc`, `ircs`, and `xmpp` that the
 * default permits on `href`.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...HREF_PROTOCOLS],
    src: [...SRC_PROTOCOLS],
  },
};

/**
 * Render Markdown through the SAME pipeline MessageContent uses and return
 * the resulting HTML string. Test-only utility — it exists so Block B's
 * sanitizer tests can assert on the post-sanitize output without rendering
 * the full component.
 *
 * Uses `react-dom/server`'s `renderToStaticMarkup` over a react-markdown
 * element configured identically to the component (remark-gfm +
 * rehype-sanitize(sanitizeSchema), no rehype-raw). This keeps the test's
 * notion of "sanitised output" faithful to runtime.
 */
export function renderSanitizedMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeSanitize, sanitizeSchema]],
      children: markdown,
    }),
  );
}
