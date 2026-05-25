// Handle interface a registered orchestrator must satisfy. The registry only
// needs enough to identify the in-flight run (messageId + kind) and to stop it
// (cancel). The concrete StreamOrchestrator (chat) and the replay/sample runs
// adapt themselves to this shape when registering.
export type OrchestratorKind = 'chat' | 'replay' | 'sample';

export interface OrchestratorHandle {
  readonly messageId: string;
  readonly kind: OrchestratorKind;
  /** Stop the in-flight run. Must be idempotent. */
  cancel(): Promise<void>;
}
