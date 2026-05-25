import {
  startPhaseBServices,
  stopPhaseBServices,
  resolvePhaseBLifecycle,
  type PhaseBLifecycle,
} from '../../src/bootstrap/lifecycle';

function stubServices(order: string[]): PhaseBLifecycle {
  return {
    janitor: {
      start: jest.fn(() => order.push('janitor.start')),
      stop: jest.fn(() => order.push('janitor.stop')),
    },
    heartbeat: {
      start: jest.fn(() => order.push('heartbeat.start')),
      stop: jest.fn(() => order.push('heartbeat.stop')),
    },
    liveEvents: {
      start: jest.fn(async () => {
        order.push('liveEvents.start');
      }),
      stop: jest.fn(async () => {
        order.push('liveEvents.stop');
      }),
    },
  };
}

describe('Phase B lifecycle', () => {
  it('starts each service exactly once', async () => {
    const order: string[] = [];
    const services = stubServices(order);
    await startPhaseBServices(services);
    expect(services.janitor.start).toHaveBeenCalledTimes(1);
    expect(services.heartbeat.start).toHaveBeenCalledTimes(1);
    expect(services.liveEvents.start).toHaveBeenCalledTimes(1);
  });

  it('stops services in reverse order (consumer first, janitor last)', async () => {
    const order: string[] = [];
    const services = stubServices(order);
    await startPhaseBServices(services);
    order.length = 0;
    await stopPhaseBServices(services);
    expect(order).toEqual(['liveEvents.stop', 'heartbeat.stop', 'janitor.stop']);
  });

  it('does not let a consumer-start failure block boot', async () => {
    const order: string[] = [];
    const services = stubServices(order);
    (services.liveEvents.start as jest.Mock).mockRejectedValueOnce(new Error('no broker'));
    await expect(startPhaseBServices(services)).resolves.toBeUndefined();
    expect(services.janitor.start).toHaveBeenCalledTimes(1);
    expect(services.heartbeat.start).toHaveBeenCalledTimes(1);
  });

  it('resolvePhaseBLifecycle pulls the three services from the Nest container', () => {
    const j = {};
    const h = {};
    const l = {};
    const app = {
      get: jest.fn((token: { name?: string }) => {
        const name = token.name;
        if (name === 'JanitorScheduler') return j;
        if (name === 'HeartbeatScheduler') return h;
        if (name === 'LiveEventsConsumer') return l;
        return undefined;
      }),
    };
    const resolved = resolvePhaseBLifecycle(app as never);
    expect(resolved.janitor).toBe(j);
    expect(resolved.heartbeat).toBe(h);
    expect(resolved.liveEvents).toBe(l);
  });
});
