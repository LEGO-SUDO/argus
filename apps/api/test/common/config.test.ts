import { loadConfig } from '../../src/common/config';

describe('loadConfig', () => {
  it('exposes the pinned defaults with no env overrides', () => {
    const c = loadConfig({});
    expect(c.classifierModel).toBe('gpt-4o-mini');
    expect(c.heartbeatIntervalMs).toBe(10_000);
    expect(c.janitorStrandedThresholdMs).toBe(60_000);
    expect(c.janitorSweepIntervalMs).toBe(30_000);
    expect(c.liveBadgeGreenThresholdMs).toBe(5_000);
    expect(c.liveBadgeErrorThresholdMs).toBe(30_000);
    expect(c.liveBadgeQueryCadenceMs).toBe(1_000);
    expect(c.sseDebounceMs).toBe(100);
    expect(c.replayOutputSizeCapBytes).toBe(262_144);
    expect(c.liveEventsTopic).toBe('live-events');
    expect(c.liveEventsConsumerGroup).toBe('api-live-fanout');
    expect(c.samplesDefaultCount).toBe(8);
  });

  it('parses env overrides', () => {
    const c = loadConfig({
      HEARTBEAT_INTERVAL_MS: '2000',
      CLASSIFIER_MODEL: 'gpt-4o',
      SAMPLES_DEFAULT_COUNT: '3',
      LIVE_EVENTS_TOPIC: 'custom-topic',
    } as NodeJS.ProcessEnv);
    expect(c.heartbeatIntervalMs).toBe(2_000);
    expect(c.classifierModel).toBe('gpt-4o');
    expect(c.samplesDefaultCount).toBe(3);
    expect(c.liveEventsTopic).toBe('custom-topic');
  });

  it('throws a clear error on a non-integer value', () => {
    expect(() =>
      loadConfig({ HEARTBEAT_INTERVAL_MS: 'not-a-number' } as NodeJS.ProcessEnv),
    ).toThrow(/Invalid API config env/);
  });

  it('derives openAiKeyConfigured from OPENAI_API_KEY presence only', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).openAiKeyConfigured).toBe(false);
    expect(loadConfig({ OPENAI_API_KEY: '' } as NodeJS.ProcessEnv).openAiKeyConfigured).toBe(false);
    expect(loadConfig({ OPENAI_API_KEY: 'sk-abc' } as NodeJS.ProcessEnv).openAiKeyConfigured).toBe(true);
    // The raw key value is never surfaced on the typed config.
    const c = loadConfig({ OPENAI_API_KEY: 'sk-secret' } as NodeJS.ProcessEnv) as Record<string, unknown>;
    expect(Object.values(c)).not.toContain('sk-secret');
  });
});
