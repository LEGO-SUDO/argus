// Tests for the traces filter <-> URLSearchParams codec (LLD Tasks 54, 56).
import { TracesQuerySchema } from '@argus/contracts';
import {
  encodeTracesFilter,
  decodeTracesFilter,
  emptyTracesFilter,
  type TracesFilter,
} from '@/lib/traces-filter-encoding';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('encodeTracesFilter (Task 54)', () => {
  it('produces a deterministic, fixed key order', () => {
    const filter: TracesFilter = {
      provider: ['openai', 'anthropic'],
      model: ['gpt-4o'],
      status: ['ok', 'failed'],
      conversationId: [UUID_A],
      search: 'hello',
    };
    // Encoding is stable run-to-run: provider, model, status, conversationId, search.
    expect(encodeTracesFilter(filter).toString()).toBe(
      encodeTracesFilter(filter).toString(),
    );
    expect(encodeTracesFilter(filter).toString()).toBe(
      'provider=openai&provider=anthropic&model=gpt-4o&status=ok&status=failed&' +
        `conversationId=${UUID_A}&search=hello`,
    );
  });

  it('emits multi-value filters as repeated keys preserving every value', () => {
    const params = encodeTracesFilter({
      ...emptyTracesFilter(),
      status: ['ok', 'failed', 'timed_out'],
    });
    expect(params.getAll('status')).toEqual(['ok', 'failed', 'timed_out']);
  });

  it('encodes the empty filter to empty params', () => {
    expect(encodeTracesFilter(emptyTracesFilter()).toString()).toBe('');
  });
});

describe('round-trip identity (Task 54)', () => {
  const cases: Record<string, TracesFilter> = {
    empty: emptyTracesFilter(),
    'single values': {
      provider: ['openai'],
      model: ['gpt-4o'],
      status: ['ok'],
      conversationId: [UUID_A],
      search: 'find me',
    },
    'multi values': {
      provider: ['openai', 'anthropic', 'gemini'],
      model: ['gpt-4o', 'claude-3-7'],
      status: ['failed', 'canceled'],
      conversationId: [UUID_A, UUID_B],
      search: '',
    },
    'search only': { ...emptyTracesFilter(), search: 'token usage' },
  };

  for (const [name, filter] of Object.entries(cases)) {
    it(`decode(encode(${name})) is identity`, () => {
      const encoded = encodeTracesFilter(filter);
      const decoded = decodeTracesFilter(new URLSearchParams(encoded.toString()));
      expect(decoded).toEqual(filter);
    });
  }
});

describe('contract alignment with TracesQuerySchema arrays (R2 reconciliation)', () => {
  // Mirrors how the api reads the query: repeated keys via getAll() → arrays,
  // which the v2 `multiFilter` query schema accepts. Proves the encoder's
  // repeated-key output is consumed as multi-value filters, not collapsed.
  function asApiQueryInput(params: URLSearchParams) {
    return {
      provider: params.getAll('provider'),
      model: params.getAll('model'),
      status: params.getAll('status'),
      conversationId: params.getAll('conversationId'),
      search: params.get('search') ?? undefined,
    };
  }

  it('encodes multi-value filters that parse back into arrays via TracesQuerySchema', () => {
    const filter: TracesFilter = {
      provider: ['openai', 'anthropic'],
      model: ['gpt-4o'],
      status: ['ok', 'failed'],
      conversationId: [UUID_A, UUID_B],
      search: 'tokens',
    };
    const parsed = TracesQuerySchema.parse(asApiQueryInput(encodeTracesFilter(filter)));
    expect(parsed.provider).toEqual(['openai', 'anthropic']);
    expect(parsed.status).toEqual(['ok', 'failed']);
    expect(parsed.conversationId).toEqual([UUID_A, UUID_B]);
    expect(parsed.search).toBe('tokens');
    expect(parsed.window).toBe('24h'); // schema default
  });

  it('encodes the empty filter to empty arrays accepted by the schema', () => {
    const parsed = TracesQuerySchema.parse(
      asApiQueryInput(encodeTracesFilter(emptyTracesFilter())),
    );
    expect(parsed.provider).toEqual([]);
    expect(parsed.status).toEqual([]);
  });
});

describe('decodeTracesFilter (Task 56)', () => {
  it('drops unknown keys silently', () => {
    const params = new URLSearchParams(
      'provider=openai&window=7d&cursor=abc&bogus=1&search=x',
    );
    const decoded = decodeTracesFilter(params);
    expect(decoded).toEqual({
      provider: ['openai'],
      model: [],
      status: [],
      conversationId: [],
      search: 'x',
    });
  });

  it('returns the empty filter for empty params', () => {
    expect(decodeTracesFilter(new URLSearchParams())).toEqual(emptyTracesFilter());
  });
});
