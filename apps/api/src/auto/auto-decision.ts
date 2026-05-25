// Value type describing one Auto-routing decision.
import type { AutoProviderId } from './category-to-provider';

export interface AutoDecision {
  /** Provider id the turn should run against. */
  provider: AutoProviderId;
  /**
   * Id of the persisted `kind='classifier'` inference row when the decision
   * came from the LLM classifier; null when the keyword heuristic decided
   * (keyless mode) or the classifier threw and we fell back.
   */
  classifierInferenceId: string | null;
}
