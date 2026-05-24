// chat-context-and-ux-polish LLD Tasks 19-25 — `listModels` on adapters and
// the `listConfiguredProviders` aggregator that joins adapters with the
// catalog for the picker REST endpoint.
import { mockProvider } from '../providers/mock';
import { listConfiguredProviders } from '../providers/list';
import type { ProviderAdapter, ProviderName } from '../providers/types';

const ORIGINAL_MOCK = process.env.MOCK_PROVIDER;

function restoreEnv() {
  if (ORIGINAL_MOCK === undefined) delete process.env.MOCK_PROVIDER;
  else process.env.MOCK_PROVIDER = ORIGINAL_MOCK;
}

afterEach(restoreEnv);

function adapter(
  name: ProviderName,
  configured: boolean,
  models: string[],
): ProviderAdapter {
  return {
    name,
    isConfigured: () => configured,
    listModels: () => models,
    async *stream() {
      throw new Error(`${name} stream not used in this test`);
    },
  };
}

describe('ProviderAdapter.listModels (Tasks 19/20)', () => {
  it('mock adapter returns the mock catalog set', () => {
    expect(mockProvider.listModels()).toEqual(['mock-1']);
  });
});

describe('listConfiguredProviders (Tasks 24/25)', () => {
  it('returns a flat catalog joined entry list for every configured adapter', () => {
    process.env.MOCK_PROVIDER = 'true';
    const out = listConfiguredProviders({
      adapters: {
        openai: adapter('openai', true, ['gpt-4o-mini', 'gpt-4o']),
        anthropic: adapter('anthropic', false, ['claude-haiku-4-5']),
        gemini: adapter('gemini', true, ['gemini-1.5-pro']),
        mock: adapter('mock', true, ['mock-1']),
      },
    });
    const pairs = out.map((e) => `${e.provider}:${e.model}`);
    expect(pairs).toContain('openai:gpt-4o-mini');
    expect(pairs).toContain('openai:gpt-4o');
    expect(pairs).toContain('gemini:gemini-1.5-pro');
    expect(pairs).toContain('mock:mock-1');
    // anthropic is NOT configured — must be excluded.
    expect(pairs).not.toContain('anthropic:claude-haiku-4-5');
  });

  it('excludes mock when MOCK_PROVIDER=false even though isConfigured() is true', () => {
    process.env.MOCK_PROVIDER = 'false';
    const out = listConfiguredProviders({
      adapters: {
        openai: adapter('openai', true, ['gpt-4o-mini']),
        anthropic: adapter('anthropic', false, []),
        gemini: adapter('gemini', false, []),
        mock: adapter('mock', true, ['mock-1']),
      },
    });
    const pairs = out.map((e) => `${e.provider}:${e.model}`);
    expect(pairs).toContain('openai:gpt-4o-mini');
    expect(pairs).not.toContain('mock:mock-1');
  });

  it('includes mock when MOCK_PROVIDER=true', () => {
    process.env.MOCK_PROVIDER = 'true';
    const out = listConfiguredProviders({
      adapters: {
        openai: adapter('openai', false, []),
        anthropic: adapter('anthropic', false, []),
        gemini: adapter('gemini', false, []),
        mock: adapter('mock', true, ['mock-1']),
      },
    });
    const pairs = out.map((e) => `${e.provider}:${e.model}`);
    expect(pairs).toEqual(['mock:mock-1']);
  });

  it('surfaces unknown catalog entries with null cost and null context window (picker renders "—")', () => {
    process.env.MOCK_PROVIDER = 'true';
    const out = listConfiguredProviders({
      adapters: {
        openai: adapter('openai', true, ['gpt-unicorn-9000']),
        anthropic: adapter('anthropic', false, []),
        gemini: adapter('gemini', false, []),
        mock: adapter('mock', false, []),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.provider).toBe('openai');
    expect(out[0]!.model).toBe('gpt-unicorn-9000');
    // Nulls (not undefined / not omitted) so the wire shape is explicit and
    // the picker's "—" rendering is unambiguous.
    expect(out[0]!.promptPerMillion).toBeNull();
    expect(out[0]!.completionPerMillion).toBeNull();
    expect(out[0]!.contextWindow).toBeNull();
  });

  it('hydrates known catalog entries with non-null cost + context window', () => {
    process.env.MOCK_PROVIDER = 'false';
    const out = listConfiguredProviders({
      adapters: {
        openai: adapter('openai', true, ['gpt-4o-mini']),
        anthropic: adapter('anthropic', false, []),
        gemini: adapter('gemini', false, []),
        mock: adapter('mock', false, []),
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.promptPerMillion).toBe(0.15);
    expect(out[0]!.completionPerMillion).toBe(0.6);
    expect(out[0]!.contextWindow).toBe(128_000);
  });
});
