// sanitize-markdown — unit tests for the rehype-sanitize schema + a small
// render helper used to assert the policy (LLD Block B, Tasks 33-46).
//
// The helper runs the SAME pipeline MessageContent uses (remark-parse →
// remark-gfm → remark-rehype → rehype-sanitize(schema) → rehype-stringify)
// and returns the sanitised HTML string so we can assert what survives.
//
// URL allow-list (locked):
//   allowed:  http, https, mailto, protocol-relative //, relative paths, #
//   stripped: javascript:, data:, vbscript: (any case, any whitespace
//             obfuscation), applied identically to anchor href and image src.
// Raw HTML tags not produced by react-markdown's own renderers are stripped.

import {
  extractScheme,
  renderSanitizedMarkdown,
  sanitizeSchema,
} from '@/lib/sanitize-markdown';

describe('sanitize-markdown — dangerous URL schemes in href', () => {
  // Task 33-34
  it('strips javascript: URLs from anchor href', () => {
    const html = renderSanitizedMarkdown('[x](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/href="javascript/i);
  });

  // Task 35-36
  it('strips data: URLs from anchor href', () => {
    const html = renderSanitizedMarkdown('[x](data:text/html,<b>hi</b>)');
    expect(html).not.toMatch(/href="data:/i);
  });

  it('strips vbscript: URLs from anchor href', () => {
    const html = renderSanitizedMarkdown('[x](vbscript:msgbox(1))');
    expect(html).not.toMatch(/href="vbscript:/i);
  });

  // Task 37-38 — case-insensitivity
  it('strips mixed-case dangerous schemes (JaVaScRiPt:, DATA:, VbScRiPt:)', () => {
    for (const scheme of ['JaVaScRiPt:alert(1)', 'DATA:text/html,x', 'VbScRiPt:x']) {
      const html = renderSanitizedMarkdown(`[x](${scheme})`);
      // The scheme prefix must not survive as an href value.
      expect(html).not.toMatch(/href="(javascript|data|vbscript):/i);
    }
  });

  // Task 39-40 — whitespace / control-char obfuscation
  it('strips whitespace/control-character obfuscated dangerous URLs', () => {
    // tab inside scheme, newline inside scheme, leading space before scheme.
    const inputs = [
      '[x](java\tscript:alert(1))',
      '[x](java\nscript:alert(1))',
      '[x]( javascript:alert(1))',
    ];
    for (const md of inputs) {
      const html = renderSanitizedMarkdown(md);
      expect(html).not.toMatch(/href="[^"]*javascript:/i);
    }
  });
});

describe('sanitize-markdown — image src follows the same rules', () => {
  // Task 41-42
  it('keeps https image src but strips javascript image src', () => {
    const safe = renderSanitizedMarkdown('![ok](https://example.com/a.png)');
    expect(safe).toMatch(/src="https:\/\/example\.com\/a\.png"/i);

    const dangerous = renderSanitizedMarkdown('![bad](javascript:alert(1))');
    expect(dangerous).not.toMatch(/src="javascript:/i);
  });

  // image src must NOT allow mailto: (href may, src may not).
  it('strips a mailto: image src (src allow-list is http/https only)', () => {
    const html = renderSanitizedMarkdown('![x](mailto:a@b.com)');
    expect(html).not.toMatch(/src="mailto:/i);
  });
});

// ---------------------------------------------------------------------------
// Codex finding #2: the case-sensitive scheme matcher could be bypassed by
// HTML-entity / percent / control-char obfuscation. `rehypeUrlSchemeGuard`
// normalizes (decode → strip control chars → lowercase) before the allow/deny
// decision. These tests pin that the obfuscated forms are all dropped.
// ---------------------------------------------------------------------------
describe('sanitize-markdown — obfuscated dangerous schemes (encoded/control)', () => {
  const obfuscated = [
    ['mixed-case javascript', '[x](JaVaScRiPt:alert(1))'],
    ['decimal-entity j (&#106;)', '[x](&#106;avascript:alert(1))'],
    ['hex-entity a (jav&#x61;script:)', '[x](jav&#x61;script:alert(1))'],
    ['hex-entity j (&#x6a;)', '[x](&#x6a;avascript:alert(1))'],
    ['entity-with-no-semicolon', '[x](&#x6aavascript:alert(1))'],
    ['percent-encoded j (%6a)', '[x](%6aavascript:alert(1))'],
    ['tab inside scheme', '[x](java\tscript:alert(1))'],
    ['newline inside scheme', '[x](java\nscript:alert(1))'],
    ['leading whitespace', '[x]( javascript:alert(1))'],
    ['null byte inside scheme', '[x](java\x00script:alert(1))'],
    ['mixed-case data', '[x](DaTa:text/html,x)'],
    ['mixed-case vbscript', '[x](VbScRiPt:msgbox(1))'],
    ['entity colon (java&#x3a;script)', '[x](javascript&#x3a;alert(1))'],
  ] as const;

  it.each(obfuscated)('drops href for %s', (_label, md) => {
    const html = renderSanitizedMarkdown(md);
    // No anchor in the output may carry a dangerous scheme in its href.
    expect(html).not.toMatch(/href="[^"]*(javascript|data|vbscript)/i);
  });
});

describe('sanitize-markdown — extractScheme normalization unit', () => {
  it.each([
    ['javascript:x', 'javascript'],
    ['JaVaScRiPt:x', 'javascript'],
    [' \t\njavascript:x', 'javascript'],
    ['jav\tascript:x', 'javascript'],
    ['jav&#x61;script:x', 'javascript'],
    ['&#106;avascript:x', 'javascript'],
    ['%6aavascript:x', 'javascript'],
    ['http://example.com', 'http'],
    ['mailto:a@b.com', 'mailto'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(extractScheme(input)).toBe(expected);
  });

  it.each([
    ['//host/path'],
    ['/relative/path'],
    ['#fragment'],
    ['relative.html'],
    ['/a:b'], // colon after slash is not a scheme delimiter
  ])('treats %s as scheme-less (relative/safe)', (input) => {
    expect(extractScheme(input)).toBeNull();
  });
});

describe('sanitize-markdown — allowed schemes survive', () => {
  // Task 43-44
  it.each([
    ['http', '[x](http://example.com/a)', /href="http:\/\/example\.com\/a"/i],
    ['https', '[x](https://example.com/a)', /href="https:\/\/example\.com\/a"/i],
    ['mailto', '[x](mailto:a@b.com)', /href="mailto:a@b\.com"/i],
    ['protocol-relative', '[x](//example.com/a)', /href="\/\/example\.com\/a"/i],
    ['relative', '[x](/local/path)', /href="\/local\/path"/i],
    ['hash', '[x](#section)', /href="#section"/i],
  ])('keeps %s links', (_label, md, pattern) => {
    const html = renderSanitizedMarkdown(md);
    expect(html).toMatch(pattern);
  });
});

describe('sanitize-markdown — raw HTML is stripped', () => {
  // Task 45-46
  it('strips raw <script> and <iframe> tags from the input', () => {
    const html = renderSanitizedMarkdown(
      'before <script>alert(1)</script> <iframe src="https://x"></iframe> after',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    // The surrounding prose still renders.
    expect(html).toMatch(/before/);
    expect(html).toMatch(/after/);
  });
});

describe('sanitize-markdown — schema export', () => {
  it('exports a schema object with restricted href/src protocol allow-lists', () => {
    expect(sanitizeSchema.protocols?.href).toEqual(
      expect.arrayContaining(['http', 'https', 'mailto']),
    );
    // Dangerous schemes are NOT present.
    expect(sanitizeSchema.protocols?.href).not.toContain('javascript');
    expect(sanitizeSchema.protocols?.href).not.toContain('data');
    expect(sanitizeSchema.protocols?.href).not.toContain('vbscript');
    expect(sanitizeSchema.protocols?.src).toEqual(
      expect.arrayContaining(['http', 'https']),
    );
    expect(sanitizeSchema.protocols?.src).not.toContain('javascript');
    // src is http/https only — mailto/data are not valid image sources.
    expect(sanitizeSchema.protocols?.src).not.toContain('mailto');
    expect(sanitizeSchema.protocols?.src).not.toContain('data');
  });
});
