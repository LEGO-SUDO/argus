import { categoryToProvider } from '../../src/auto/category-to-provider';
import type { Category } from '../../src/auto/keyword-heuristic';

describe('categoryToProvider', () => {
  it('maps known categories to provider ids', () => {
    expect(categoryToProvider('coding')).toBe('anthropic');
    expect(categoryToProvider('research')).toBe('gemini');
    expect(categoryToProvider('general')).toBe('openai');
  });

  it('throws on an unknown category so schema drift surfaces', () => {
    expect(() => categoryToProvider('nonsense' as Category)).toThrow(/Unknown Auto category/);
  });
});
