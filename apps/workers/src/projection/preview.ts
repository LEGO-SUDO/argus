// Derive the human-readable `input_preview` / `output_preview` columns from a
// span's body events.
//
// Why this exists (REVIEW-BRIEF Finding 1): the SDK emits the full prompt /
// completion as span EVENTS (`llm.input` / `llm.output` body), but never sets
// the `llm.input_preview` / `llm.output_preview` ATTRIBUTES. The projection
// consumer used to read those attributes directly, so the columns were always
// NULL — which blanked Replay's "original" pane and killed Traces content
// search. We derive the previews here from the body that already rides the
// span: one source of truth, no SDK-contract change, no extra bytes on the wire.
//
// Body shapes this must absorb (the SAME value the mapper stores as
// trace_events.payload — `evt.body ?? evt.attributes`):
//   - real wire:   the body string is nested as an event ATTRIBUTE, so the raw
//                  value is `{ body: '<string>', truncated: false }`. For
//                  `llm.input` that inner string is JSON (`{"messages":[…]}`);
//                  for `llm.output` it is the assistant text verbatim.
//   - unit tests:  `evt.body` is the object directly — `{ messages: [...] }`
//                  for input, `{ content: '...' }` (or a bare string) for output.
//
// Output: the last user message's content (input) or the assistant text
// (output), trimmed and capped at `max` chars to satisfy the `.max(500)`
// contract on the column. Returns `undefined` when there is nothing usable so
// the column stays NULL rather than holding an empty string.

const DEFAULT_MAX = 500;

export function previewOf(raw: unknown, max = DEFAULT_MAX): string | undefined {
  const text = extractText(raw);
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function extractText(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return fromMaybeJson(raw);
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    // Real-wire span event: the payload string is nested under the `body`
    // event attribute (alongside `truncated`).
    if (typeof o.body === 'string') return fromMaybeJson(o.body);
    if (o.body != null && typeof o.body === 'object') return fromStructured(o.body);
    return fromStructured(o);
  }
  return undefined;
}

// An input body string is JSON (`{"messages":[…]}`); an output body string is
// plain assistant text. Try to parse as JSON; fall back to the raw string when
// it is not JSON (the output case).
function fromMaybeJson(s: string): string {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return fromStructured(JSON.parse(t));
    } catch {
      return s;
    }
  }
  return s;
}

function fromStructured(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return messagesToText(v) ?? JSON.stringify(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.messages)) return messagesToText(o.messages) ?? JSON.stringify(o.messages);
    if (typeof o.content === 'string') return o.content;
    return JSON.stringify(o);
  }
  return String(v);
}

// Prefer the last user turn (the prompt that triggered this inference); fall
// back to the last message carrying content.
function messagesToText(messages: unknown[]): string | undefined {
  const withContent = messages.filter(
    (m): m is { role?: string; content: string } =>
      !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string',
  );
  if (withContent.length === 0) return undefined;
  const lastUser = [...withContent].reverse().find((m) => m.role === 'user');
  return (lastUser ?? withContent[withContent.length - 1]!).content;
}
