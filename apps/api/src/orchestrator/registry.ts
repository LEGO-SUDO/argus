// OrchestratorRegistry — per-user in-memory map of in-flight chat + replay +
// sample orchestrator handles.
//
// Backs two flows: the chat gateway / replay service register a handle on
// start and deregister on terminal; the Clear flow calls `cancelAll(userId)`
// to stop every in-flight run before fencing + deleting. Per-user buckets keep
// `cancelAll` scoped so one user's clear never touches another user's streams.
import { Injectable } from '@nestjs/common';
import { captureApiError } from '../observability/sentry';
import type { OrchestratorHandle } from './handle';

@Injectable()
export class OrchestratorRegistry {
  // Map<userId, Map<messageId, handle>> — inner Map preserves insertion order.
  private readonly byUser = new Map<string, Map<string, OrchestratorHandle>>();

  register(userId: string, handle: OrchestratorHandle): void {
    let bucket = this.byUser.get(userId);
    if (!bucket) {
      bucket = new Map();
      this.byUser.set(userId, bucket);
    }
    bucket.set(handle.messageId, handle);
  }

  /** Remove a handle by key. Unknown (userId, messageId) is a silent no-op. */
  deregister(userId: string, messageId: string): void {
    const bucket = this.byUser.get(userId);
    if (!bucket) return;
    bucket.delete(messageId);
    if (bucket.size === 0) this.byUser.delete(userId);
  }

  /** Handles for a user in insertion order. Empty array when none. */
  list(userId: string): OrchestratorHandle[] {
    const bucket = this.byUser.get(userId);
    return bucket ? [...bucket.values()] : [];
  }

  /**
   * Cancel every in-flight handle for the user. Iterates a snapshot so a
   * handle that deregisters itself mid-cancel can't mutate what we walk; a
   * throw from one handle is captured and the rest still get cancelled. The
   * user's bucket is dropped once every cancel has resolved.
   */
  async cancelAll(userId: string): Promise<void> {
    const bucket = this.byUser.get(userId);
    if (!bucket) return;
    const handles = [...bucket.values()];
    for (const handle of handles) {
      try {
        await handle.cancel();
      } catch (err) {
        captureApiError({
          err,
          feature: 'console',
          layer: 'service',
          extra: { stage: 'cancelAll', userId, messageId: handle.messageId },
        });
      }
    }
    this.byUser.delete(userId);
  }
}
