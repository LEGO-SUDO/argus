// replayInputReconstructor — pure helper assembling the input for a replay
// run from the source inference + its conversation history.
//
// Selects exactly: system prompt, the triggering user message, the prior
// history up to (and including) that message in chronological order, plus
// temperature + max-tokens. Everything else the source might carry (tools,
// attachments, provider-specific knobs) is intentionally dropped — replay
// re-runs the conversational input, not the full provider call envelope.

export interface ReplaySourceLike {
  conversationId: string;
  system?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  // tools / attachments / providerSpecific etc. are ignored by construction.
  [key: string]: unknown;
}

export interface ReplayHistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
}

export interface ReconstructorInput {
  source: ReplaySourceLike;
  triggeringUserMessage: ReplayHistoryMessage;
  history: ReplayHistoryMessage[];
}

export interface ReconstructedReplayInput {
  system: string | null;
  userMessage: { role: 'user'; content: string };
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature: number | null;
  maxTokens: number | null;
}

export function reconstructReplayInput(input: ReconstructorInput): ReconstructedReplayInput {
  const boundary = input.triggeringUserMessage.createdAt.getTime();

  const seen = new Set<string>();
  const ordered = input.history
    .filter((m) => m.createdAt.getTime() <= boundary)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

  const history = ordered.map((m) => ({ role: m.role, content: m.content }));

  // Guarantee the triggering user message is present exactly once, as the
  // final entry before the assistant turn.
  if (!seen.has(input.triggeringUserMessage.id)) {
    history.push({ role: 'user', content: input.triggeringUserMessage.content });
  }

  return {
    system: input.source.system ?? null,
    userMessage: { role: 'user', content: input.triggeringUserMessage.content },
    history,
    temperature: input.source.temperature ?? null,
    maxTokens: input.source.maxTokens ?? null,
  };
}
