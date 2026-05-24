// sanitize-markdown — the rehype-sanitize schema used by MessageContent, a
// pre-sanitize URL-scheme guard that defeats encoded/obfuscated dangerous
// schemes, plus a small render helper for tests (LLD Block B, Tasks 33-46).
//
// Defense-in-depth model (HLD Decision 7):
//   1. react-markdown is configured WITHOUT `rehype-raw`, so raw HTML in the
//      Markdown source is escaped to text before the rehype pipeline runs.
//   2. `rehypeUrlSchemeGuard` (THIS module) runs FIRST in the rehype pipeline.
//      It normalizes every href/src — lowercasing, stripping leading control
//      chars/whitespace, and decoding HTML entities + percent-encoding — then
//      drops the attribute outright if the resolved scheme is not on the
//      allow-list. This closes the bypass where `jav&#x61;script:`,
//      `JaVaScRiPt:`, `java&#9;script:`, or `%6a%61vascript:` slip past a
//      naive case-sensitive matcher.
//   3. rehype-sanitize with THIS schema is the final line of defence: it drops
//      any element/attribute not on the allow-list and re-validates URL
//      schemes against the locked protocol allow-list.
//
// URL scheme allow-list (locked):
//   href: http, https, mailto, protocol-relative `//`, relative paths, `#`
//   src:  http, https ONLY (an image must never be a mailto/data/javascript)
//   stripped everywhere: javascript:, data:, vbscript: (any case, any
//   entity/percent/control-char obfuscation).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
// `rehype-sanitize` re-exports the schema type as `Options` (it's the
// `hast-util-sanitize` `Schema`). We alias it to `SanitizeSchema` for a
// readable public type name.
import type { Options as SanitizeSchema } from 'rehype-sanitize';

// Minimal structural hast node shapes. We declare them locally rather than
// importing from `@types/hast` because `apps/web` does not directly depend on
// that package (it is only a transitive dep of the rehype stack); a direct
// `import 'hast'` would be a fragile cross-package type reach.
type HastProperties = Record<string, unknown>;
interface HastElement {
  type: 'element';
  tagName: string;
  properties?: HastProperties;
  children: HastNode[];
}
interface HastRoot {
  type: 'root';
  children: HastNode[];
}
type HastNode =
  | HastRoot
  | HastElement
  | { type: string; children?: HastNode[] };

/**
 * Locked URL scheme allow-list. The `//` (protocol-relative), relative, and
 * `#` (hash) forms are NOT schemes — they're treated as safe by the
 * "no scheme present → relative" rule below, so they don't appear here.
 *
 * `href` permits `mailto`; `src` does NOT — an image source must only ever be
 * fetched over http/https (a `mailto:`/`data:`/`javascript:` image src is
 * either nonsensical or an exfiltration/exec vector).
 */
const HREF_PROTOCOLS = ['http', 'https', 'mailto'] as const;
const SRC_PROTOCOLS = ['http', 'https'] as const;

/**
 * The sanitize schema MessageContent passes to `rehype-sanitize`. Derived
 * from hast-util-sanitize's GitHub-style `defaultSchema` (which already
 * restricts tagNames to the safe Markdown-rendered set and strips raw
 * `<script>`/`<iframe>`/etc.), with the href/src protocol allow-lists
 * tightened to the locked set. We drop `irc`, `ircs`, and `xmpp` that the
 * default permits on `href`, and `mailto` from `src`.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...HREF_PROTOCOLS],
    src: [...SRC_PROTOCOLS],
  },
};

// ---------------------------------------------------------------------------
// Scheme normalization + the pre-sanitize guard plugin.
// ---------------------------------------------------------------------------

/** Attribute → its allow-list. Anything not listed is left untouched. */
const URL_ATTR_ALLOWLIST: Record<string, readonly string[]> = {
  href: HREF_PROTOCOLS,
  src: SRC_PROTOCOLS,
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  tab: '\t',
  newline: '\n',
  colon: ':',
};

/**
 * Decode HTML character references (`&#106;`, `&#x6a;`, `&colon;`, `&amp;`)
 * and percent-encoding (`%6a`) in a URL-ish string. Best-effort — we only
 * need enough fidelity to surface a hidden scheme; the fully decoded value is
 * NOT what we render (rehype-sanitize keeps the original attribute when it
 * passes), it is only what we inspect to make the allow/deny decision.
 */
function decodeForSchemeInspection(raw: string): string {
  let out = raw;
  // Numeric + named HTML entities. Run twice to catch double-encoding
  // (`&amp;#x6a;` → `&#x6a;` → `j`).
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    );
    out = out.replace(/&#(\d+);?/g, (_m, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10)),
    );
    out = out.replace(/&([a-z]+);?/gi, (m, name: string) => {
      const mapped = NAMED_ENTITIES[name.toLowerCase()];
      return mapped ?? m;
    });
  }
  // Percent-encoding (`%6a%61vascript:`). Decode known-safe sequences only.
  out = out.replace(/%([0-9a-f]{2})/gi, (_m, hex: string) =>
    safeFromCodePoint(parseInt(hex, 16)),
  );
  return out;
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Extract the normalized scheme from a (possibly obfuscated) URL value, or
 * `null` when the value is relative / scheme-less (which is always safe).
 *
 * Normalization:
 *   - decode entities + percent-encoding (so `jav&#x61;script:` reveals
 *     `javascript:`);
 *   - strip ALL leading whitespace and C0 control bytes including NUL, tab,
 *     newline, CR (so `\tjavascript:` and `java\nscript:` collapse);
 *   - lowercase.
 *
 * A value is scheme-less (returns null) when there is no `:` before the first
 * `/`, `?`, or `#` — matching the URL spec's "the first colon, if any,
 * delimits the scheme" rule. `//host`, `/path`, `#frag` therefore pass.
 */
export function extractScheme(rawValue: string): string | null {
  const decoded = decodeForSchemeInspection(rawValue);
  // Remove every C0 control char (incl. \t \n \r NUL) and ASCII space
  // ANYWHERE before the scheme delimiter — obfuscators inject them mid-scheme
  // too (`java\tscript:`), not just leading. \x00-\x20 covers NUL..space.
  // eslint-disable-next-line no-control-regex
  const stripped = decoded.replace(/[\x00-\x20]+/g, '');
  const colon = stripped.indexOf(':');
  if (colon === -1) return null;
  // If a path/query/hash delimiter appears before the colon, the colon is not
  // a scheme delimiter (e.g. `/a:b`, `#a:b`) — treat as relative/safe.
  const slash = stripped.search(/[/?#]/);
  if (slash !== -1 && slash < colon) return null;
  const scheme = stripped.slice(0, colon).toLowerCase();
  // A valid scheme is ASCII letters/digits/+/-/. starting with a letter.
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;
  return scheme;
}

/**
 * Rehype plugin: walk the tree and strip any `href`/`src` whose normalized
 * scheme is not on that attribute's allow-list. Scheme-less (relative,
 * protocol-relative, hash) values are always kept. Runs BEFORE
 * rehype-sanitize so even a value that the downstream sanitizer's
 * case-sensitive matcher would mishandle is already gone.
 */
export function rehypeUrlSchemeGuard() {
  return (tree: HastRoot): void => {
    visit(tree, (node) => {
      if (node.type !== 'element') return;
      const el = node as HastElement;
      const props = el.properties;
      if (!props) return;
      for (const attr of Object.keys(URL_ATTR_ALLOWLIST)) {
        const value = props[attr];
        if (typeof value !== 'string') continue;
        const scheme = extractScheme(value);
        if (scheme === null) continue; // relative / scheme-less → safe
        const allow = URL_ATTR_ALLOWLIST[attr]!;
        if (!allow.includes(scheme)) {
          // Drop the attribute entirely — never render a denied scheme.
          delete props[attr];
        }
      }
    });
  };
}

/** Minimal depth-first hast walker (avoids a unist-util-visit dependency). */
function visit(node: HastNode, fn: (n: HastNode) => void): void {
  fn(node);
  const children = (node as { children?: HastNode[] }).children;
  if (!children) return;
  for (const child of children) {
    if (child.type === 'element' || child.type === 'root') {
      visit(child, fn);
    }
  }
}

/**
 * Render Markdown through the SAME pipeline MessageContent uses and return
 * the resulting HTML string. Test-only utility — it exists so Block B's
 * sanitizer tests can assert on the post-sanitize output without rendering
 * the full component.
 *
 * Pipeline parity: remark-gfm + `rehypeUrlSchemeGuard` (FIRST) +
 * rehype-sanitize(sanitizeSchema), no rehype-raw — identical to the runtime
 * component's `rehypePlugins` order.
 */
export function renderSanitizedMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeUrlSchemeGuard, [rehypeSanitize, sanitizeSchema]],
      },
      // Pass the Markdown source as a child (third arg) rather than a
      // `children` prop — react-markdown reads either, and the createElement
      // child form keeps eslint's react/no-children-prop happy.
      markdown,
    ),
  );
}
