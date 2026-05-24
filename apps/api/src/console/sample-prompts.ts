// Sample prompts — a pure fixture of varied demo prompts the Generate-Samples
// flow cycles through. Each carries an intended provider/model for display
// variety in the console, but the actual orchestrator run always targets mock
// (sample turns never hit real providers — HLD D5).
export interface SamplePrompt {
  content: string;
  provider: string;
  model: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  { content: 'Write a haiku about distributed systems.', provider: 'openai', model: 'gpt-4o-mini' },
  { content: 'Explain the CAP theorem in two sentences.', provider: 'anthropic', model: 'claude-haiku-4-5' },
  { content: 'Refactor this loop into a map/filter pipeline.', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  { content: 'Summarize the history of the TCP handshake.', provider: 'gemini', model: 'gemini-3-flash-preview' },
  { content: 'Compare REST and GraphQL for a mobile client.', provider: 'gemini', model: 'gemini-1.5-pro' },
  { content: 'What is a monad, intuitively?', provider: 'openai', model: 'gpt-4o' },
  { content: 'Debug this regex that never matches.', provider: 'anthropic', model: 'claude-haiku-4-5' },
  { content: 'Draft a friendly out-of-office reply.', provider: 'openai', model: 'gpt-4o-mini' },
];
