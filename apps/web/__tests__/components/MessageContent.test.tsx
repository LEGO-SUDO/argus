// MessageContent — RTL tests for the Markdown-rendering message body (LLD
// Block E, Tasks 68-79).
//
// Assistant content renders through react-markdown + remark-gfm +
// rehype-sanitize(sanitizeSchema). User content renders as inert plain text
// (no Markdown processing). Raw HTML is escaped/stripped. External links get
// new-tab attributes; same-origin links do not. Partial mid-stream Markdown
// renders without throwing.

import { cleanup, render } from '@testing-library/react';
import { MessageContent } from '@/components/chat/MessageContent';

function renderAssistant(content: string) {
  return render(<MessageContent role="assistant" content={content} />);
}

describe('MessageContent — markdown-body styling hook (design review FIX 1)', () => {
  // The assistant render path wraps its output in `.markdown-body`, which is
  // the CSS hook `app/globals.css` styles (headings/lists/tables/code, mobile
  // overflow). The previous design-review blocker was that this class existed
  // in the DOM but had ZERO matching CSS, so Tailwind's preflight stripped all
  // semantic typography.
  //
  // LIMITATION: jsdom does NOT load `globals.css` and cannot compute styles
  // from a stylesheet, so this suite asserts the STRUCTURE the CSS targets
  // (the wrapper class is present and the semantic elements are emitted) — a
  // structural/snapshot assertion is the ceiling in jsdom. The actual rendered
  // appearance is verified by the deferred Playwright screenshot baseline in
  // `tests/e2e/specs/markdown-rendering.spec.ts` (needs a live stack).
  it('wraps rendered markdown in the .markdown-body class CSS keys off', () => {
    const { getByTestId } = renderAssistant('# Title\n\ntext');
    const body = getByTestId('message-content-markdown');
    expect(body).toHaveClass('markdown-body');
  });

  it('emits the semantic elements the .markdown-body rules target', () => {
    const md = [
      '# H1',
      '## H2',
      '### H3',
      '',
      'a paragraph with a [link](https://example.com).',
      '',
      '- list item',
      '',
      '> a quote',
      '',
      'inline `code` and:',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n');
    const { container } = renderAssistant(md);
    // Every element the CSS block restyles must be present so the rules can
    // bind. (We cannot assert computed styles in jsdom — see suite note.)
    expect(container.querySelector('.markdown-body h1')).not.toBeNull();
    expect(container.querySelector('.markdown-body h2')).not.toBeNull();
    expect(container.querySelector('.markdown-body h3')).not.toBeNull();
    expect(container.querySelector('.markdown-body p')).not.toBeNull();
    expect(container.querySelector('.markdown-body ul li')).not.toBeNull();
    expect(container.querySelector('.markdown-body blockquote')).not.toBeNull();
    expect(container.querySelector('.markdown-body a')).not.toBeNull();
    expect(container.querySelector('.markdown-body p code')).not.toBeNull();
    expect(container.querySelector('.markdown-body pre code')).not.toBeNull();
    expect(container.querySelector('.markdown-body table th')).not.toBeNull();
    expect(container.querySelector('.markdown-body table td')).not.toBeNull();
  });
});

describe('MessageContent — assistant Markdown constructs', () => {
  // Task 68-69 — one assertion per PRD construct.
  it('renders a heading as a heading element', () => {
    const { container } = renderAssistant('# Title');
    expect(container.querySelector('h1')).toHaveTextContent('Title');
  });

  it('renders bold as <strong>', () => {
    const { container } = renderAssistant('**bold**');
    expect(container.querySelector('strong')).toHaveTextContent('bold');
  });

  it('renders italic as <em>', () => {
    const { container } = renderAssistant('*italic*');
    expect(container.querySelector('em')).toHaveTextContent('italic');
  });

  it('renders an unordered list as <ul><li>', () => {
    const { container } = renderAssistant('- one\n- two');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('renders inline code as <code> inside a paragraph', () => {
    const { container } = renderAssistant('use `npm install` here');
    const code = container.querySelector('p code');
    expect(code).toHaveTextContent('npm install');
  });

  it('renders a fenced code block as <pre><code>', () => {
    const { container } = renderAssistant('```\nconst x = 1;\n```');
    const pre = container.querySelector('pre code');
    expect(pre).toHaveTextContent('const x = 1;');
  });

  it('renders a GFM table as <table>', () => {
    const md = ['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
    const { container } = renderAssistant(md);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('table td')).toHaveLength(2);
  });

  it('renders a GFM task list with checkbox inputs', () => {
    const md = '- [x] done\n- [ ] todo';
    const { container } = renderAssistant(md);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
  });
});

describe('MessageContent — user content is inert', () => {
  // Task 70-71
  it('renders user content as literal text, not Markdown', () => {
    const { container } = render(
      <MessageContent role="user" content="**bold** and [link](https://x)" />,
    );
    // The literal markdown characters survive as text.
    expect(container.textContent).toContain('**bold**');
    expect(container.textContent).toContain('[link](https://x)');
    // No semantic elements were produced.
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('MessageContent — partial/streaming Markdown', () => {
  // Task 72-73
  it.each([
    ['open fence, no closer', '```\nconst x = 1;'],
    ['unfinished link', '[label]('],
    ['open table row', '| a | b |\n| - |'],
  ])('renders truncated Markdown (%s) without throwing', (_label, md) => {
    expect(() =>
      render(<MessageContent role="assistant" content={md} isStreaming />),
    ).not.toThrow();
    cleanup();
  });

  it('emits visible text from a partial fenced block', () => {
    // NOTE: content passed via a curly expression so the `\n` is a real
    // newline (a `\n` inside a JSX string attribute would be a literal
    // backslash-n and would not open a fenced block).
    const { container } = render(
      <MessageContent
        role="assistant"
        content={'```\nconst x = 1;'}
        isStreaming
      />,
    );
    expect(container.textContent).toContain('const x = 1;');
  });
});

describe('MessageContent — raw HTML is inert', () => {
  // Task 74-75 — the security property: no executable HTML reaches the DOM.
  //
  // Because react-markdown runs WITHOUT rehype-raw, raw HTML in the source is
  // not parsed into elements at all — the dangerous tags never become DOM
  // nodes (and rehype-sanitize is the second line of defence). react-markdown
  // drops the raw-HTML nodes entirely rather than echoing the literal angle
  // brackets, so we assert on the ABSENCE of dangerous elements + attributes
  // and that the surrounding prose still renders.
  it('renders raw <script>/<img onerror> as inert (no executable elements)', () => {
    const { container } = renderAssistant(
      'before <script>alert(1)</script> <img src="x" onerror="alert(1)"> after',
    );
    expect(container.querySelector('script')).toBeNull();
    // The injected <img> must not survive as an element with the handler.
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // No inline event handler leaked anywhere.
    expect(container.innerHTML).not.toMatch(/onerror/i);
    // Surrounding prose still renders.
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
  });
});

describe('MessageContent — link target handling', () => {
  // Task 76-77 — external links get new-tab attributes.
  it('adds target=_blank and rel=noopener noreferrer to external links', () => {
    const { container } = renderAssistant('[ext](https://example.com/x)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(a?.getAttribute('rel')).toContain('noreferrer');
  });

  // Task 78-79 — same-origin links do NOT get new-tab attributes.
  it('does NOT add new-tab attributes to same-origin links', () => {
    // jsdom's default origin is http://localhost. Use that origin so the
    // renderer classifies the link as same-origin.
    const origin = window.location.origin;
    const { container } = renderAssistant(`[home](${origin}/dashboard)`);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a).not.toHaveAttribute('target', '_blank');
    expect(a?.getAttribute('rel') ?? '').not.toContain('noopener');
  });

  it('treats relative links as same-origin (no new-tab attributes)', () => {
    const { container } = renderAssistant('[rel](/local/path)');
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a).not.toHaveAttribute('target', '_blank');
  });
});
