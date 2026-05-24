// AutoRouterService — entry point the chat gateway calls when the user selects
// the `Auto` provider. Branches on OpenAI-key presence:
//   - keyed:   run the LLM classifier adapter (persists a kind='classifier'
//              row), map its category to a provider. If the classifier throws,
//              capture it and fall back to the keyword heuristic. Classifier
//              errors are explicitly NOT part of provider failover — they
//              always degrade to the heuristic.
//   - keyless: run the in-process keyword heuristic directly (no row written).
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG_TOKEN, type ApiConfig } from '../common/config';
import { captureApiError } from '../observability/sentry';
import { ClassifierAdapter } from './classifier-adapter';
import { classifyByKeyword } from './keyword-heuristic';
import { categoryToProvider } from './category-to-provider';
import type { AutoDecision } from './auto-decision';

export interface AutoRouteInput {
  userId: string;
  conversationId: string;
  userMessageId: string;
  content: string;
  turnIndex?: number;
}

@Injectable()
export class AutoRouterService {
  constructor(
    @Inject(API_CONFIG_TOKEN) private readonly config: ApiConfig,
    private readonly classifier: ClassifierAdapter,
  ) {}

  async route(input: AutoRouteInput): Promise<AutoDecision> {
    if (this.config.openAiKeyConfigured) {
      try {
        const { category, inferenceId } = await this.classifier.classify(input);
        return { provider: categoryToProvider(category), classifierInferenceId: inferenceId };
      } catch (err) {
        // Classifier failure is NOT failover — degrade to the heuristic.
        captureApiError({
          err,
          feature: 'auto',
          layer: 'service',
          extra: { stage: 'classify', conversationId: input.conversationId },
        });
      }
    }
    const category = classifyByKeyword(input.content);
    return { provider: categoryToProvider(category), classifierInferenceId: null };
  }
}
