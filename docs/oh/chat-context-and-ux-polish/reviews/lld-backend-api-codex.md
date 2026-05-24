## 0. Format Violations

Hard rejection: the LLD repeatedly includes implementation-level shapes and detailed test assertions.

- Quote: `New SDK request field on ChatStreamRequest: pin — an object carrying provider + model.`
- Quote: `New SDK error code on override-branch failure: pinned_provider_unavailable`
- Quote: `New ChatStreamChunk variant for the commit signal: commit — carries the same shape as done's providerMeta`
- Quote: `New Prisma columns on Conversation: TS-side pinnedProvider / pinnedModel, both nullable, both with @map...`

These are not full code blocks, but they are type/API design declarations embedded as binding implementation detail. Keep the prose contract, but avoid type/interface-like declarations unless the HLD already fixes them.

- Quote: `Export getEffectiveBudget(configuredDefault, pinnedProvider?, pinnedModel?)`
- Quote: `buildMetadataFrame(messageId, seq, providerMeta)`
- Quote: `ContextMeterService.compute(conversationId, userId)`
- Quote: `pin?: { provider: ProviderName; model: string }`

These are function/type signatures. Replace with prose I/O descriptions.

Detailed test assertions are over-specified throughout.

- Quote: `Assert the orchestrator emits, in order: start with seq=0 and no provider/model fields, metadata with seq=1 carrying the providerMeta from the commit, token with seq=2 and content='hello', end with seq=3 and status='complete'.`
- Quote: `Seed a conversation with: complete user msg → complete assistant msg → streaming-but-orphan assistant msg → invoke startTurn...`
- Quote: `Assert the emitted sequence is exactly [start@seq=0, error, end@status='failed']`

These belong in tests, not the LLD. The task should state behavior to cover, not prescribe full fixtures and assertion order unless the order itself is the requirement.

Tasks exceed bite-sized scope.

- Quote: `Task 16 ... Extend ProviderAdapter... Add listModels implementations to every existing adapter. Implement listConfiguredProviders... Re-export...`
- Quote: `Task 27 ... Wire the commit chunk handler... update existing tests... remove provider/model... terminal end... confirm gateway path...`
- Quote: `Task 37 ... Gateway reads pin, computes effective budget, threads SDK request fields, removes mock literals`
- Quote: `Task 43 ... Extend ConversationsRepository + ConversationsController PATCH... add contract fields... validate against live catalog... update DTO...`

These are multi-file, multi-behavior tasks. Split each into smaller RED/GREEN slices.

Testable behavior without proper RED/GREEN pairing:

- Quote: `Task 43 ... add the two optional nullable string fields to ConversationDtoSchema ... this is a contract addition that should also have a small RED/GREEN pair, BUT... bundle the schema addition in this task`
  
This explicitly violates the LLD’s own TDD structure. Add a RED task for `ConversationDtoSchema`, then a GREEN task.

- Quote: `Task 39 (GREEN): Confirm wire-visible propagation... No production code change required`
  
This is not a GREEN implementation task unless paired with an actual failing test and an implementation decision. If it is inspection-only, label it `[non-TDD — verification]`; if behavior may break, make it a normal GREEN task with concrete code acceptance.

## 1. Tasks Too Vague To Execute

- Quote: `providerMeta object (provider + model, both strings — leave the object open-shaped per HLD D1 so future fields can land without contract churn).`

“Open-shaped” is ambiguous for Zod. Does this mean `.passthrough()`, `.catchall(z.unknown())`, or simply not strict? Builder needs exact schema policy because it affects unknown keys.

- Quote: `first-configured-adapter-name`

Undefined ordering. Is it router failover order, object insertion order, catalog order, env order, or SDK adapter priority? This affects observability and tests.

- Quote: `model is read from the first done if available, otherwise the first model in the adapter's listModels() is used as a provisional value and corrected when done lands`

A `commit` chunk is emitted before the first token, while `done` arrives later. The LLD does not define how a previously emitted commit is “corrected” in a stream protocol. Is there a second metadata frame? Should frontend update on `done`? This conflicts with “metadata frame must NEVER be emitted twice.”

- Quote: `reuse the existing context-window.ts estimator helper — extract it to a small shared util if necessary`

Too discretionary. Pick one. Cross-module imports can easily create dependency cycles.

- Quote: `takes PrismaService + a SDK catalog accessor in its constructor`

Which accessor? Direct import from SDK, injected wrapper, or provider token? This matters for Nest testing and mocking.

- Quote: `mock is listed only when MOCK_PROVIDER=true (the default — env hook)`

Ambiguous default. Does absent env mean mock enabled or disabled? The parenthetical says default true, but later tasks rely on “configured providers,” which may conflict with production behavior.

## 2. Missing Acceptance Criteria

Most tasks have acceptance and verify commands. Gaps are mainly acceptance that cannot be observed cleanly:

- Task 48: acceptance says `Operator can paste a Jaeger trace URL into the PR description`. That is not reproducible in CI and depends on local infra. Fine as a smoke task, but acceptance should also list exact span names/attrs expected.

- Task 39: acceptance only says `Task 38's test passes`. If no production code change is expected, acceptance should explicitly require evidence of the inspected code path or a comment location.

- Task 43: acceptance misses contract package verification after modifying `packages/contracts/src/conversations.ts`. It only says API tests/typecheck. Add contracts test/typecheck.

## 3. Test Gaps

- No explicit test that `metadata.seq` must be exactly `1` for the first metadata frame. Task 3 allows integer `seq >= 1`; Task 26 checks orchestrator emits `1`, but contract-level invariant in the header says `metadata@1`.

- No test that `tokensUsed` / `tokensBudget` on `end` are only emitted for `status: complete`. Task 6 says orchestrator enforcement lives in API, but Task 35 only tests happy path and meter failure. Add failed/canceled terminal tests that meter is not called and fields are absent.

- No test for malformed `pin` request values at SDK boundary. Contract validates conversation PATCH, but SDK `ChatStreamRequest` can be called internally. If runtime validation is absent by design, state that.

- No test that `UpdateConversationRequestSchema` rejects empty strings for only one or both pin fields. Task 10 mentions non-empty strings, Task 9 does not test empty strings.

- No test for duplicate `commit` chunks in the SDK router. API guards duplicate metadata, but SDK should also prove “exactly once.”

- No API test that `GET /providers` returns unknown catalog entries with null costs/context window. SDK tests cover helper behavior, but controller response shape should preserve nulls.

- No migration rollback/down strategy is mentioned. If this repo uses only forward SQL migrations, say so.

## 4. File-Path Errors

Potentially risky paths, not confirmed against repo:

- Quote: `apps/api/test/providers/providers.controller.test.ts`

If existing tests are grouped under `apps/api/test/conversations` and `apps/api/test/chat`, this is plausible. But the LLD should tell the builder to mirror existing controller test module setup.

- Quote: `apps/api/src/conversations/context-window.ts`

Later `ContextMeterService` lives under `chat` but may import from `conversations`, while Task 45 says avoid circular imports. This path ownership is suspicious. A shared util under `apps/api/src/chat` or `apps/api/src/common` may be cleaner.

- Quote: `packages/sdk/src/providers/list.ts`, `packages/sdk/src/providers/types.ts`

Task 16 assumes a providers directory and types file exist. If they do not, the task needs to say create/move carefully, or avoid naming exact paths.

## 5. Hand-Off Risk

The biggest risk is protocol inconsistency around `commit`, `metadata`, and `done`.

- The SDK may emit a provisional model in `commit`, then learn a different model at `done`.
- The API says metadata emits once only.
- The frontend gets provider/model from metadata.
- The LLD says the picker chip may update if model differs, but the backend task does not define a second wire-visible correction.

This needs a single source of truth before implementation.

The PR sequencing is internally inconsistent. Preamble says PR 1 is Tasks 1-28 plus frontend reducer/frame-type tasks. But Task 31 adds history required by Task 37, Task 23 migration is needed by Task 31, and Task 36 onward depends on pin columns. The “backbone” cut may compile but will not deliver multi-turn context or pin behavior.

The live catalog validation in Task 43 can reject a model that exists in the static catalog but whose adapter is currently unconfigured. That is likely intended, but it means persisted pins are environment-specific. The fallback resolver partially handles this, but PATCH behavior and GET behavior should explicitly share the same resolver/helper.

The default context budget bump from `6000` to `10000` is buried in Task 33. That is cross-cutting config behavior and should be its own RED/GREEN pair because it can break existing tests and product expectations.

Task 40 asks the controller test to verify `MOCK_PROVIDER` env behavior while also stubbing the SDK helper. If the helper is stubbed, the controller cannot prove SDK env gating. Move env-gating tests to SDK only, or do not stub the helper for that case.

## 6. Quality Score

5/10.

The design is thorough and mostly coherent, but it is too implementation-heavy for an LLD task plan, several tasks are too large, and the `commit`/metadata correction semantics need resolution before handing this to a builder.
