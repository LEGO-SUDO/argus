import { classifyByKeyword } from '../../src/auto/keyword-heuristic';

describe('classifyByKeyword', () => {
  it('returns "coding" for representative coding prompts', () => {
    const prompts = [
      'Why does this function throw a null pointer exception?',
      'Here is a Rust stack trace from rustc, what went wrong?',
      'Write a regex to match emails',
      'My SQL query is slow, can you optimize it?',
      'How do I memoize a React component?',
      'This code will not compile in TypeScript',
    ];
    for (const p of prompts) {
      expect(classifyByKeyword(p)).toBe('coding');
    }
  });

  it('returns "research" for representative research prompts', () => {
    const prompts = [
      'Summarize the literature on attention mechanisms',
      'Compare the pros and cons of REST vs GraphQL at a high level',
      'Give me an overview of the historical context of the Cold War',
      'Research and analyze recent trends in renewable energy',
      'Explain in depth the difference between inflation and deflation',
    ];
    for (const p of prompts) {
      expect(classifyByKeyword(p)).toBe('research');
    }
  });

  it('returns "general" for non-matching prompts and is case-insensitive', () => {
    expect(classifyByKeyword('What is the weather like today?')).toBe('general');
    expect(classifyByKeyword('Tell me a joke please')).toBe('general');
    expect(classifyByKeyword('hello there, how are you')).toBe('general');
    // Case-insensitive: uppercase coding prompt still classifies as coding.
    expect(classifyByKeyword('DEBUG THIS FUNCTION')).toBe('coding');
  });

  it('treats whitespace-only / empty input as general', () => {
    expect(classifyByKeyword('   ')).toBe('general');
    expect(classifyByKeyword('')).toBe('general');
    expect(classifyByKeyword('\n\t  ')).toBe('general');
  });
});
