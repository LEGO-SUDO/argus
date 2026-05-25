// Typed env config for the Phase B control-plane services.
//
// `loadConfig(env)` is a pure function over an env bag so tests can exercise
// defaults / overrides / validation without re-importing the module or mutating
// `process.env`. `config` is the production singleton parsed from `process.env`
// once at import. `apiConfigProvider` wires the singleton into Nest DI under
// `API_CONFIG_TOKEN`.
//
// Secrets stay in process env: only the boolean `openAiKeyConfigured` derived
// flag is exposed — never the OpenAI key value itself.
import { z } from 'zod';

// Integer env var with a default; throws a clear ZodError on a non-integer
// value (Task 6: invalid value → clear thrown error).
const intEnv = (def: number) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    z.coerce.number().int(),
  );

const EnvSchema = z.object({
  // Only used when an OpenAI key is configured (the classifier call).
  CLASSIFIER_MODEL: z.preprocess(
    (v) => (v === undefined || v === '' ? 'gpt-4o-mini' : v),
    z.string().min(1),
  ),
  OPENAI_API_KEY: z.string().optional(),
  HEARTBEAT_INTERVAL_MS: intEnv(10_000),
  JANITOR_STRANDED_THRESHOLD_MS: intEnv(60_000),
  JANITOR_SWEEP_INTERVAL_MS: intEnv(30_000),
  LIVE_BADGE_GREEN_THRESHOLD_MS: intEnv(5_000),
  LIVE_BADGE_ERROR_THRESHOLD_MS: intEnv(30_000),
  LIVE_BADGE_QUERY_CADENCE_MS: intEnv(1_000),
  SSE_DEBOUNCE_MS: intEnv(100),
  REPLAY_OUTPUT_SIZE_CAP_BYTES: intEnv(262_144),
  LIVE_EVENTS_TOPIC: z.preprocess(
    (v) => (v === undefined || v === '' ? 'live-events' : v),
    z.string().min(1),
  ),
  LIVE_EVENTS_CONSUMER_GROUP: z.preprocess(
    (v) => (v === undefined || v === '' ? 'api-live-fanout' : v),
    z.string().min(1),
  ),
  SAMPLES_DEFAULT_COUNT: intEnv(8),
});

export interface ApiConfig {
  classifierModel: string;
  /** Derived: true when OPENAI_API_KEY is a non-empty string. */
  openAiKeyConfigured: boolean;
  heartbeatIntervalMs: number;
  janitorStrandedThresholdMs: number;
  janitorSweepIntervalMs: number;
  liveBadgeGreenThresholdMs: number;
  liveBadgeErrorThresholdMs: number;
  liveBadgeQueryCadenceMs: number;
  sseDebounceMs: number;
  replayOutputSizeCapBytes: number;
  liveEventsTopic: string;
  liveEventsConsumerGroup: string;
  samplesDefaultCount: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid API config env: ${issues}`);
  }
  const e = parsed.data;
  return {
    classifierModel: e.CLASSIFIER_MODEL,
    openAiKeyConfigured: typeof e.OPENAI_API_KEY === 'string' && e.OPENAI_API_KEY.length > 0,
    heartbeatIntervalMs: e.HEARTBEAT_INTERVAL_MS,
    janitorStrandedThresholdMs: e.JANITOR_STRANDED_THRESHOLD_MS,
    janitorSweepIntervalMs: e.JANITOR_SWEEP_INTERVAL_MS,
    liveBadgeGreenThresholdMs: e.LIVE_BADGE_GREEN_THRESHOLD_MS,
    liveBadgeErrorThresholdMs: e.LIVE_BADGE_ERROR_THRESHOLD_MS,
    liveBadgeQueryCadenceMs: e.LIVE_BADGE_QUERY_CADENCE_MS,
    sseDebounceMs: e.SSE_DEBOUNCE_MS,
    replayOutputSizeCapBytes: e.REPLAY_OUTPUT_SIZE_CAP_BYTES,
    liveEventsTopic: e.LIVE_EVENTS_TOPIC,
    liveEventsConsumerGroup: e.LIVE_EVENTS_CONSUMER_GROUP,
    samplesDefaultCount: e.SAMPLES_DEFAULT_COUNT,
  };
}

/** Production singleton — parsed once from process.env at import. */
export const config: ApiConfig = loadConfig();

/** Nest DI token for the typed config object. */
export const API_CONFIG_TOKEN = Symbol('API_CONFIG');

export const apiConfigProvider = {
  provide: API_CONFIG_TOKEN,
  useValue: config,
};
