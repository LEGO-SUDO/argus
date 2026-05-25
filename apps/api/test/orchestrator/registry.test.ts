import { randomUUID } from 'crypto';
import { OrchestratorRegistry } from '../../src/orchestrator/registry';
import type { OrchestratorHandle, OrchestratorKind } from '../../src/orchestrator/handle';
import * as sentry from '../../src/observability/sentry';

function handle(kind: OrchestratorKind = 'chat'): OrchestratorHandle & { cancel: jest.Mock } {
  const messageId = randomUUID();
  return { messageId, kind, cancel: jest.fn(async () => undefined) };
}

describe('OrchestratorRegistry', () => {
  it('register + list returns per-user handles in insertion order', () => {
    const reg = new OrchestratorRegistry();
    const a = randomUUID();
    const b = randomUUID();
    const a1 = handle();
    const a2 = handle('replay');
    const b1 = handle();
    reg.register(a, a1);
    reg.register(a, a2);
    reg.register(b, b1);
    expect(reg.list(a)).toEqual([a1, a2]);
    expect(reg.list(b)).toEqual([b1]);
    expect(reg.list(randomUUID())).toEqual([]);
  });

  it('deregister removes a handle; unknown key is a silent no-op', () => {
    const reg = new OrchestratorRegistry();
    const u = randomUUID();
    const h = handle();
    reg.register(u, h);
    reg.deregister(u, h.messageId);
    expect(reg.list(u)).toEqual([]);
    // no-op paths
    expect(() => reg.deregister(u, 'nope')).not.toThrow();
    expect(() => reg.deregister('ghost', 'nope')).not.toThrow();
  });

  it('cancelAll cancels only the target user and removes their handles', async () => {
    const reg = new OrchestratorRegistry();
    const a = randomUUID();
    const b = randomUUID();
    const a1 = handle();
    const a2 = handle('replay');
    const b1 = handle();
    reg.register(a, a1);
    reg.register(a, a2);
    reg.register(b, b1);

    await reg.cancelAll(a);

    expect(a1.cancel).toHaveBeenCalledTimes(1);
    expect(a2.cancel).toHaveBeenCalledTimes(1);
    expect(b1.cancel).not.toHaveBeenCalled();
    expect(reg.list(a)).toEqual([]);
    expect(reg.list(b)).toEqual([b1]);
  });

  it('cancelAll swallows a handle error, cancels the rest, captures it', async () => {
    const spy = jest.spyOn(sentry, 'captureApiError').mockImplementation(() => undefined);
    const reg = new OrchestratorRegistry();
    const u = randomUUID();
    const bad = handle();
    bad.cancel.mockRejectedValueOnce(new Error('cancel failed'));
    const good = handle();
    reg.register(u, bad);
    reg.register(u, good);

    await expect(reg.cancelAll(u)).resolves.toBeUndefined();
    expect(good.cancel).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ feature: 'console', layer: 'service' }));
    expect(reg.list(u)).toEqual([]);
    spy.mockRestore();
  });
});
