1. **Wire Contract Coherence**

   Metadata shape is coherent: backend emits `{ type:'metadata', messageId, seq:1, providerMeta:{provider,model,...} }`, contract accepts it, reducer reads `frame.providerMeta.provider/model`.

   End token fields are coherent: backend emits top-level `tokensUsed` / `tokensBudget`; contract declares them top-level; reducer reads them top-level only on `status === 'complete'`.

   Runtime gap: reducer does not validate `metadata.seq === 1`; it trusts already-parsed frames. If WS parsing is bypassed or loosened, bad metadata seq still mutates provider/model.

2. **`commit` → Metadata → Seq Ordering**

   Backend normal path is correct: `start@0`, `commit` emits `metadata@1`, non-empty tokens start at `seq=2`. SDK wrapper suppresses leading empty tokens, so empty-token-before-commit no longer steals `seq=1`.

   Integration risk: web reducer explicitly treats metadata as out-of-band and does not enforce ordering. A late `metadata@1` after token frames still updates the active streaming message. Backend should prevent this in normal SDK path, but the frontend will not protect itself from token-before-metadata or metadata-after-token if a malformed stream slips through.

   Also, backend defensive `done`-without-commit path emits metadata only if no token was emitted. If a malformed SDK yields token(s), then `done` without commit, the completed row has no provider/model. That degrades but violates the stated “metadata exactly once per completed turn” invariant.

3. **Pin Lifecycle Round Trip**

   PATCH set/clear bodies are coherent: web sends both fields together; backend schema rejects asymmetric patches; backend validates non-null pins against `listConfiguredProviders()`.

   Major integration bug: first-turn pin does not affect the first turn. `MessageComposer` holds the pin while `conversationId === null`, sends the message, then PATCHes only after the `start` frame mints the conversation id. But `ChatGateway.startTurn()` already read the conversation pin before streaming. The first response will use auto/failover, while the UI already showed the selected pin. The PATCH is valid, but too late for that turn.

   Resume fallback loop is mostly coherent: backend returns effective null pins plus `pinFallback:true` and `previouslyPinned`; hook reads it; composer renders notice.

4. **Context Meter Source Agreement**

   Backend puts `tokensUsed` / `tokensBudget` on messages-list response root and complete `end` frames; web reads both correctly.

   Graft risk: `mapHistory()` attaches root meter values to the latest completed assistant row. But `ContextMeterService.compute()` returns conversation-wide current usage, not necessarily usage for that specific assistant turn. If the latest row is not the turn that caused the current meter state, or if message ordering is unusual/tied, the UI can display a conversation-level meter as if it belongs to that row. This is probably acceptable for “latest completed assistant row” UI, but it is not truly per-message data.

5. **Error / Edge Propagation**

   Pinned-provider failure path looks coherent: SDK throws `ProviderError('pinned_provider_unavailable')`; orchestrator maps error code via `errorCodeOf(err)` and emits WS error; reducer likely displays via existing error handling.

   Meter failure degrades correctly: orchestrator catches, logs/captures, emits complete `end` without token fields; reducer leaves tokens absent, so meter can hide.

   Edge: if metadata never arrives and stream completes, reducer still promotes a complete assistant message with undefined provider/model. Any UI assuming provider/model exists on completed assistant messages can break at runtime.

6. **Runtime-Only Breaks**

   First-turn pin is the main seam failure: UI pin selection before conversation mint is not included in the WS start/send payload and cannot influence backend `startTurn()`.

   Frontend accepts late metadata for an active stream and mutates provider/model after tokens have rendered. Backend normal path prevents it, but this is not defended end-to-end.

   Defensive backend metadata-from-`done` cannot repair commit-less streams after any token; completed messages can lack provider/model despite the stated protocol.

7. **Quality Score**

   **7/10** integration-ready. Core wire shapes match, token fields line up, and fallback/error paths mostly degrade cleanly. The first-turn pin race is a real product-visible integration bug.
