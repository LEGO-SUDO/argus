// Pure map from an Auto-router category to the provider id that should serve
// the turn. Exhaustive switch on the category union — an unrecognized value
// throws so classifier/heuristic schema drift surfaces immediately rather than
// silently routing to a default.
import type { Category } from './keyword-heuristic';

export type AutoProviderId = 'openai' | 'anthropic' | 'gemini';

export function categoryToProvider(category: Category): AutoProviderId {
  switch (category) {
    case 'coding':
      return 'anthropic';
    case 'research':
      return 'gemini';
    case 'general':
      return 'openai';
    default: {
      const exhaustive: never = category;
      throw new Error(`Unknown Auto category: ${String(exhaustive)}`);
    }
  }
}
