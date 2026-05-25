// Unit coverage for previewOf — the body shapes it must absorb are documented
// in src/projection/preview.ts (REVIEW-BRIEF Finding 1).
import { previewOf } from '../src/projection/preview';

describe('previewOf', () => {
  it('returns undefined for null/empty so the column stays NULL', () => {
    expect(previewOf(undefined)).toBeUndefined();
    expect(previewOf(null)).toBeUndefined();
    expect(previewOf('   ')).toBeUndefined();
    expect(previewOf({ body: '', truncated: false })).toBeUndefined();
  });

  it('reads the real-wire input body (JSON nested under the body attribute)', () => {
    const raw = {
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'be terse' },
          { role: 'user', content: 'hello there' },
        ],
      }),
      truncated: false,
    };
    expect(previewOf(raw)).toBe('hello there');
  });

  it('reads the real-wire output body (plain assistant text)', () => {
    expect(previewOf({ body: 'Paris is the capital.', truncated: false })).toBe('Paris is the capital.');
  });

  it('reads the unit-test object shapes directly', () => {
    expect(previewOf({ messages: [{ role: 'user', content: 'hi' }] })).toBe('hi');
    expect(previewOf({ content: 'world' })).toBe('world');
    expect(previewOf('bare string')).toBe('bare string');
  });

  it('prefers the last user message over earlier turns', () => {
    const raw = {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
      ],
    };
    expect(previewOf(raw)).toBe('second');
  });

  it('caps the preview at the requested length', () => {
    const long = 'x'.repeat(600);
    expect(previewOf(long, 500)).toHaveLength(500);
  });
});
