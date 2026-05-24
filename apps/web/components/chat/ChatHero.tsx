// ChatHero — the empty-state rendered when there's no active conversation
// and no messages. Pure presentational; the parent owns the starter pick
// handler so clicking a starter card pre-fills the composer.
//
// Mirrors `.chat-hero` + `.starters` + `.starter` rules in
// `docs/design/project/styles.css` (lines 458-511) and the `ChatHero` JSX
// in `docs/design/project/chat.jsx`.
//
// The h1 uses Instrument Serif 56px with the italic accent on the key
// word — the design intent is a calm, premium first impression.
'use client';

type Starter = {
  title: string;
  sub: string;
};

const STARTERS: Starter[] = [
  { title: 'Help me draft a reply', sub: 'to a customer asking for a refund' },
  { title: 'Summarize this thread', sub: 'in 5 bullet points, no fluff' },
  { title: 'Cost down our LLM bill', sub: 'ideas for cutting spend 30%' },
  {
    title: 'Write a launch announcement',
    sub: 'for a small B2B product',
  },
];

type ChatHeroProps = {
  /** Called when a starter card is clicked. The parent should pre-fill the
   *  composer with `${title} ${sub}` — matches the design's flow. */
  onPickStarter: (text: string) => void;
};

export function ChatHero({ onPickStarter }: ChatHeroProps) {
  return (
    <div
      data-testid="chat-empty-hero"
      className="mx-auto max-w-[720px] px-7 pt-20 pb-10 text-left"
    >
      <div
        data-testid="chat-empty-hero-eyebrow"
        className="mb-3.5 text-[11px] uppercase tracking-[0.08em] text-chat-ink-3"
      >
        argus · mock provider on
      </div>
      <h1
        className="serif m-0 mb-3.5 text-[56px] font-normal leading-[1.05] tracking-[-0.02em] text-chat-ink"
        style={{ textWrap: 'balance' }}
      >
        How can I <em className="italic text-acc">help</em> today?
      </h1>
      <p className="m-0 mb-7 max-w-[480px] text-[15px] leading-[1.55] text-chat-ink-2">
        Type a message below to start a new thread. Every turn streams in real
        time and is captured to the inference log. The operator console
        (available at{' '}
        <span className="mono" style={{ fontSize: 13 }}>
          /console
        </span>{' '}
        in Phase B) will surface traces, cost, and replay views over the same
        stream.
      </p>
      <div
        data-testid="chat-empty-hero-starters"
        className="mb-7 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {STARTERS.map((s) => (
          <button
            key={s.title}
            type="button"
            data-testid={`chat-empty-hero-starter-${slugify(s.title)}`}
            aria-label={`Use starter: ${s.title}`}
            onClick={() => onPickStarter(`${s.title} ${s.sub}`)}
            className="text-left rounded-[10px] border border-chat-rule bg-chat-panel px-4 py-3.5 text-[13.5px] leading-[1.4] text-chat-ink transition-colors hover:border-acc hover:bg-chat-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-acc"
          >
            {s.title}
            <div className="mt-[3px] text-[11.5px] text-chat-ink-2">{s.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kebab-case slugify used only for stable testids on the starter buttons. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
